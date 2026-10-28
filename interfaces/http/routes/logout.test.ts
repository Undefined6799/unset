// P2.08 (routes/logout.ts): POST /logout ends this browser's session behind the kit's CSRF gate, and GET /signed-out
// says so. The session store is P2.03's, tested against Postgres in tests/integration/session; here it records calls.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as web from "@unset/apps-web";
import type { Did } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { testPage } from "../web/fixtures/page.ts";
import { ISSUER_READ_MS, type LogoutDeps, logoutRoutes } from "./logout.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

type World = {
  session?: Session | null;
  destroyFails?: boolean;
  remaining?: number;
  /** The issuer OAuth recorded for the DID; a throw stands for an unreadable token set. `"stall"` never settles. */
  issuer?: string | null | Error | "stall";
  /** The last browser's revocation fails at the PDS (P2.08g). */
  revokeFails?: boolean;
  /** P1.36y: what the recount under the account's lock finds: a sign-in finished meanwhile, or the lock failed. */
  underLock?: "still_last" | "signed_in_meanwhile" | "lock_fails";
};

function setup(world: World = {}) {
  const destroyed: Session[] = [];
  const calls: string[] = [];
  const lines: Record<string, unknown>[] = [];
  let issuerSignal: AbortSignal | undefined;
  const log = createLogger({
    service: "http",
    commit: "c".repeat(40),
    env: "test",
    write: (l) => lines.push(JSON.parse(l)),
  });
  const deps: LogoutDeps = {
    readSession: async () => (world.session === undefined ? SESSION : world.session),
    destroySession: async (session) => {
      calls.push("destroy");
      if (world.destroyFails) throw new Error("db down");
      destroyed.push(session);
      // Another browser still holds a session, so this path must not revoke the shared grant.
      return world.remaining ?? 1;
    },
    issuerOf: async (_did, signal?: AbortSignal) => {
      calls.push("issuerOf");
      issuerSignal = signal;
      if (world.issuer === "stall") {
        return new Promise((_resolve, reject) => {
          const fail = () => reject(signal?.reason ?? new Error("stall"));
          if (signal === undefined || signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        });
      }
      const issuer = world.issuer === undefined ? OUR_ISSUER : world.issuer;
      if (issuer instanceof Error) throw issuer;
      return issuer;
    },
    revokeGrant: async () => {
      calls.push("revoke");
      if (world.remaining !== 0) throw new Error("revoke is not this test");
      if (world.revokeFails) throw new Error("RevokeDown");
    },
    deleteTokenSet: async () => {
      calls.push("deleteTokenSet");
      if (!world.revokeFails) throw new Error("token delete is not this test");
    },
    whenLastBrowser: async (_did, _deadline, fn) => {
      calls.push("lock");
      if (world.underLock === "lock_fails") throw new Error("LockTimeout");
      if (world.underLock === "signed_in_meanwhile") return;
      await fn();
    },
    page: testPage(log),
    screens: web.screens,
    pdsIssuer: OUR_ISSUER,
    log,
  };
  const server = createServer({ config: CONFIG, routes: logoutRoutes(deps), policies, log });
  const send = (
    path: string,
    init: { method?: string; site?: "same-origin" | "cross-site"; body?: string; cookie?: string } = {},
  ) => {
    const method = init.method ?? "POST";
    const cookie = ["__Host-sid=x", ...(init.cookie === undefined ? [] : [init.cookie])].join("; ");
    const headers = new Headers({ host: "unset.test", "x-forwarded-for": "192.0.2.1", cookie });
    if (method === "GET") return server.request(new Request(`${ORIGIN}${path}`, { headers }), "10.0.0.1");
    const site = init.site ?? "same-origin";
    headers.set("content-type", "application/x-www-form-urlencoded");
    headers.set("sec-fetch-site", site);
    headers.set("origin", site === "same-origin" ? ORIGIN : "https://evil.example");
    return server.request(new Request(`${ORIGIN}${path}`, { method, headers, body: init.body ?? "" }), "10.0.0.1");
  };
  return { send, destroyed, lines, calls, issuerSignal: () => issuerSignal };
}

const OUR_ISSUER = "https://pds.unset.test";
const FOREIGN_ISSUER = "https://pds.example";
const ISSUER_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Strict";
const issuerCookie = (origin: string) => `__Host-signed_out_issuer=${Buffer.from(origin).toString("base64url")}`;
const CLEAR_ISSUER = `__Host-signed_out_issuer=; ${ISSUER_ATTRIBUTES}; Max-Age=0`;
const SIGNED_OUT = [
  "__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
  "__Host-oauth_nonce=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
  "__Host-login_target=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
  "__Host-signed_out=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
];
/** P2.08b: what the signed-out page reads to link the issuer recorded at sign-in. */
const carries = (origin: string) => [...SIGNED_OUT, `${issuerCookie(origin)}; ${ISSUER_ATTRIBUTES}; Max-Age=600`];

describe("POST /logout", () => {
  test("logout_this_browser", async () => {
    const { send, destroyed, lines } = setup();
    const response = await send("/logout");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual(carries(OUR_ISSUER));
    expect(destroyed).toEqual([SESSION]);
    expect(lines.filter((line) => line.event === "auth.logout_this_browser")).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain(DID);
  });

  test("logout_no_session_idempotent", async () => {
    const { send, destroyed } = setup({ session: null });
    const response = await send("/logout");
    expect(response.headers.get("location")).toBe("/signed-out");
    // Nobody's issuer is known, so a stale one from an earlier sign-out is cleared.
    expect(response.headers.getSetCookie()).toEqual([...SIGNED_OUT, CLEAR_ISSUER]);
    expect(destroyed).toEqual([]);
  });

  test("logout_get_405", async () => {
    const { send, destroyed } = setup();
    expect((await send("/logout", { method: "GET" })).status).toBe(405);
    expect(destroyed).toEqual([]);
  });

  test("logout_csrf", async () => {
    const { send, destroyed } = setup();
    expect((await send("/logout", { site: "cross-site" })).status).toBe(403);
    expect(destroyed).toEqual([]);
  });

  test("logout_db_failure_keeps_the_cookie", async () => {
    // Book P2.08 step 3: a failed delete is a retryable 503, and the cookie stays so the retry finds it.
    const { send } = setup({ destroyFails: true });
    const response = await send("/logout");
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    // P2.08b: the book's own words for this failure, not the generic 503 text.
    expect(await response.text()).toContain("Could not sign you out, try again.");
  });

  test("logout_reads_the_issuer_before_destroying", async () => {
    // The last browser's revoke deletes the token set, which is where the issuer is recorded, and an overlapping
    // second POST must find it before either destroy runs (P2.08g, verify-1054 mutant 14).
    const { send, calls } = setup({ remaining: 0 });
    const response = await send("/logout");
    expect(response.headers.getSetCookie()).toEqual(carries(OUR_ISSUER));
    expect(calls).toEqual(["issuerOf", "destroy", "lock", "revoke"]);
  });

  test("logout_double_click_ends_at_the_fallback_link", async () => {
    // The second POST of a double click finds no session, so nobody's issuer is known: it clears the carrier and
    // the signed-out page links our PDS. Safe, if less helpful (architecture 04:15Z item 1; verify-1054 M1).
    const first = await setup({ issuer: FOREIGN_ISSUER }).send("/logout");
    expect(first.headers.getSetCookie()).toEqual(carries(FOREIGN_ISSUER));
    const second = await setup({ session: null, issuer: FOREIGN_ISSUER }).send("/logout");
    expect(second.headers.getSetCookie()).toEqual([...SIGNED_OUT, CLEAR_ISSUER]);
    const html = await (await setup({ session: null }).send("/signed-out", { method: "GET" })).text();
    expect(html).toContain('href="https://pds.unset.test/account"');
    expect(html).not.toContain("pds.example");
  });

  test("logout_carries_the_normalised_origin", async () => {
    // The library allows an issuer with a path (@atproto/oauth-types 0.7.7 oauth-issuer-identifier.js); only its
    // origin is carried, lower-cased and without the default port (P2.08g, verify-1054 mutant 16).
    for (const issuer of ["HTTPS://PDS.Example:443/oauth", "https://pds.example/"]) {
      const response = await setup({ issuer }).send("/logout");
      expect(response.headers.getSetCookie(), issuer).toEqual(carries(FOREIGN_ISSUER));
    }
  });

  test("logout.last_browser_revoke_fails", async () => {
    // routes/logout.ts revokeOrDrop: when the PDS refuses the revocation, the stored set is still deleted, so no
    // grant remains on our side (P2.08g, adopted from verify-1056's scratch probe).
    const { send, calls, lines } = setup({ remaining: 0, revokeFails: true });
    const response = await send("/logout");
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(calls).toEqual(["issuerOf", "destroy", "lock", "revoke", "deleteTokenSet"]);
    expect(lines.filter((line) => line.event === "oauth.revoke_failed")).toEqual([
      expect.objectContaining({ kind: "Error" }),
    ]);
    expect(JSON.stringify(lines)).not.toContain(DID);
  });

  test("logout.last_browser_keeps_a_grant_a_new_sign_in_took", async () => {
    // P1.36y: the count said last browser, but under the account's lock a sign-in elsewhere had already finished, so
    // the grant it stored stays.
    const { send, calls } = setup({ remaining: 0, underLock: "signed_in_meanwhile" });
    expect((await send("/logout")).headers.get("location")).toBe("/signed-out");
    expect(calls).toEqual(["issuerOf", "destroy", "lock"]);
  });

  test("logout.last_browser_revokes_when_the_lock_fails", async () => {
    // P1.36y: no lock is no reason to keep a grant nobody uses (review F13); the revoke runs without it.
    const { send, calls, lines } = setup({ remaining: 0, underLock: "lock_fails", revokeFails: true });
    expect((await send("/logout")).headers.get("location")).toBe("/signed-out");
    expect(calls).toEqual(["issuerOf", "destroy", "lock", "revoke", "deleteTokenSet"]);
    expect(lines.filter((line) => line.event === "oauth.revoke_failed")[0]).toEqual(
      expect.objectContaining({ kind: "Error" }),
    );
    expect(JSON.stringify(lines)).not.toContain(DID);
  });

  test("logout_stalled_issuer_read_signs_out", async () => {
    // P2.08h M5: the issuer read settles when its deadline fires, then the session is destroyed. The fallback link
    // is our PDS. ISSUER_READ_MS is well below PG_CONNECT_TIMEOUT_MS (default 2000).
    const started = Date.now();
    const { send, destroyed, calls, lines, issuerSignal } = setup({ issuer: "stall" });
    const response = await send("/logout");
    expect(Date.now() - started).toBeLessThan(ISSUER_READ_MS + 500);
    expect(ISSUER_READ_MS).toBeLessThan(500);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.getSetCookie()).toEqual([...SIGNED_OUT, CLEAR_ISSUER]);
    expect(destroyed).toEqual([SESSION]);
    expect(calls).toEqual(["issuerOf", "destroy"]);
    expect(issuerSignal()?.aborted).toBe(true);
    expect(lines.filter((line) => line.event === "auth.logout_issuer_unknown")).toEqual([
      expect.objectContaining({ kind: expect.any(String) }),
    ]);
    expect(JSON.stringify(lines)).not.toContain(DID);
    const page = await (await setup({ session: null }).send("/signed-out", { method: "GET" })).text();
    expect(page).toContain('href="https://pds.unset.test/account"');
  }, 1_500);

  test("logout_with_an_unreadable_issuer_still_signs_out", async () => {
    const { send, destroyed, lines } = setup({ issuer: new Error("unseal failed") });
    const response = await send("/logout");
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.getSetCookie()).toEqual([...SIGNED_OUT, CLEAR_ISSUER]);
    expect(destroyed).toEqual([SESSION]);
    expect(lines.filter((line) => line.event === "auth.logout_issuer_unknown")).toEqual([
      expect.objectContaining({ kind: "Error" }),
    ]);
    expect(JSON.stringify(lines)).not.toContain(DID);
  });

  test("logout_drops_a_pending_sign_in", async () => {
    // A sign-in started before signing out must not finish after it: its authorization URL was made without
    // prompt=login, so /login/continue and the callback could sign the browser straight back in.
    for (const session of [SESSION, null]) {
      const cookies = (await setup({ session }).send("/logout")).headers.getSetCookie();
      expect(cookies).toContain("__Host-oauth_nonce=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
      expect(cookies).toContain("__Host-login_target=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");
    }
  });
});

// P2.08d: "Sign out everywhere" is removed (Alex, 2026-10-19 02:34:31Z). Its path is an unknown route, and nothing
// is signed out by it.
test("logout_everywhere_is_gone", async () => {
  const { send, destroyed } = setup();
  const response = await send("/logout/everywhere", { body: "confirm=yes" });
  expect(response.status).toBe(404);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(destroyed).toEqual([]);
});

test("signed_out_page", async () => {
  const { send } = setup({ session: null });
  const response = await send("/signed-out", { method: "GET" });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("You are signed out of unset");
  expect(html).toContain("Also sign out of your atproto account?");
  expect(html).toContain('href="https://pds.unset.test/account"');
});

test("signed_out_links_the_foreign_issuer_recorded_at_sign_in", async () => {
  // P2.08b, the book's edge case: a user whose PDS is not ours is sent to their own issuer, never our /account.
  const signOut = await setup({ issuer: FOREIGN_ISSUER }).send("/logout");
  expect(signOut.headers.getSetCookie()).toEqual(carries(FOREIGN_ISSUER));
  const response = await setup({ session: null }).send("/signed-out", {
    method: "GET",
    cookie: issuerCookie(FOREIGN_ISSUER),
  });
  const html = await response.text();
  expect(html).toContain('href="https://pds.example/"');
  expect(html).toContain("your sign-in server (pds.example)");
  expect(html).not.toContain("pds.unset.test");
  expect(html).not.toContain("only place you type your password");
});

test("signed_out_links_our_issuer_from_the_cookie", async () => {
  const response = await setup({ session: null }).send("/signed-out", {
    method: "GET",
    cookie: issuerCookie(OUR_ISSUER),
  });
  const html = await response.text();
  expect(html).toContain('href="https://pds.unset.test/account"');
  expect(html).toContain("You are going to pds.unset.test, our sign-in server");
});

test("signed_out_never_takes_the_issuer_from_the_query", async () => {
  const response = await setup({ session: null }).send("/signed-out?issuer=https%3A%2F%2Fevil.example", {
    method: "GET",
  });
  const html = await response.text();
  expect(html).not.toContain("evil.example");
  expect(html).toContain('href="https://pds.unset.test/account"');
});

test("signed_out.cookie_rejects_non_origin", async () => {
  // Architecture 04:15Z item 2: anything but exactly one https origin falls back to our PDS: a path, a query, a
  // fragment, a user part, a port, another scheme, garbage, or two cookies.
  const bad = [
    issuerCookie("https://pds.example/account"),
    issuerCookie("https://pds.example/"),
    issuerCookie("https://pds.example?next=1"),
    issuerCookie("https://pds.example#top"),
    issuerCookie("https://user@pds.example"),
    issuerCookie("https://pds.example:8443"),
    issuerCookie("http://pds.example"),
    issuerCookie("javascript:alert(1)"),
    "__Host-signed_out_issuer=%%%",
    `${issuerCookie(FOREIGN_ISSUER)}; ${issuerCookie("https://other.example")}`,
  ];
  for (const cookie of bad) {
    const html = await (await setup({ session: null }).send("/signed-out", { method: "GET", cookie })).text();
    expect(html).toContain('href="https://pds.unset.test/account"');
    expect(html).not.toContain("pds.example");
    expect(html).not.toContain("javascript:");
  }
});

/** P2.08h: a refused issuer is not carried, and the signed-out page falls back to our PDS. */
async function refusedIssuerFallsBack(issuer: string, absent: string): Promise<void> {
  const posted = await setup({ issuer }).send("/logout");
  expect(posted.headers.getSetCookie()).toEqual([...SIGNED_OUT, CLEAR_ISSUER]);
  const html = await (
    await setup({ session: null }).send("/signed-out", { method: "GET", cookie: issuerCookie(issuer) })
  ).text();
  expect(html).toContain('href="https://pds.unset.test/account"');
  expect(html).not.toContain(absent);
}

test("signed_out.carrier_refuses_ipv4", () => refusedIssuerFallsBack("https://198.51.100.1", "198.51.100.1"));
test("signed_out.carrier_refuses_ipv6", () => refusedIssuerFallsBack("https://[2001:db8::1]", "2001:db8"));
test("signed_out.carrier_refuses_localhost", () => refusedIssuerFallsBack("https://localhost", "localhost"));
test("signed_out.carrier_refuses_localhost_child", () =>
  refusedIssuerFallsBack("https://app.localhost", "app.localhost"));
test("signed_out.carrier_refuses_trailing_dot", () => refusedIssuerFallsBack("https://pds.example.", "pds.example"));
test("signed_out.carrier_refuses_port", () => refusedIssuerFallsBack("https://pds.example:8443", "pds.example"));

test("signed_out.carrier_keeps_a_dns_name", async () => {
  // A name that merely contains the letters of localhost is still a DNS name. So is one label, and a name
  // that ends in `.example`. The default port is normalised away (already an origin).
  for (const issuer of ["https://notlocalhost", "https://localhost.example", "https://notlocalhost.example"]) {
    const response = await setup({ issuer }).send("/logout");
    expect(response.headers.getSetCookie(), issuer).toEqual(carries(issuer));
  }
});

test("signed_out.cookie_single_use", async () => {
  // Item 1: the response that reads the carried issuer clears it, so a reload links our PDS.
  const response = await setup({ session: null }).send("/signed-out", {
    method: "GET",
    cookie: issuerCookie(FOREIGN_ISSUER),
  });
  expect(await response.text()).toContain('href="https://pds.example/"');
  expect(response.headers.getSetCookie()).toEqual([CLEAR_ISSUER]);
  const rejected = await setup({ session: null }).send("/signed-out", {
    method: "GET",
    cookie: issuerCookie("https://pds.example:8443"),
  });
  expect(rejected.headers.getSetCookie()).toEqual([CLEAR_ISSUER]);
  const none = await setup({ session: null }).send("/signed-out", { method: "GET" });
  expect(none.headers.getSetCookie()).toEqual([]);
});

test("signed_out.ours_exact_match", async () => {
  // Item 4: ours only when equal, as a string, to our PDS issuer. A lookalike that ends or starts with our host is
  // foreign: it gets the plain foreign link and never the "our sign-in server" sentence.
  for (const lookalike of ["https://evilpds.unset.test", "https://pds.unset.test.example"]) {
    const html = await (
      await setup({ session: null }).send("/signed-out", { method: "GET", cookie: issuerCookie(lookalike) })
    ).text();
    expect(html, lookalike).not.toContain("You are going to");
    expect(html, lookalike).not.toContain(`href="${lookalike}/account"`);
    expect(html, lookalike).toContain(`href="${lookalike}/"`);
  }
});

test("signed_out.cookie_never_logged", async () => {
  // Item 3 (SE-7): a user's PDS origin can identify them, so neither it nor a parse failure reaches a log line.
  for (const cookie of [issuerCookie(FOREIGN_ISSUER), issuerCookie("https://pds.example:8443/x")]) {
    const { send, lines } = setup({ session: null });
    await send("/signed-out", { method: "GET", cookie });
    expect(JSON.stringify(lines)).not.toContain("pds.example");
    expect(JSON.stringify(lines)).not.toContain(cookie.split("=")[1]);
  }
  const { send, lines } = setup({ issuer: FOREIGN_ISSUER });
  await send("/logout");
  expect(JSON.stringify(lines)).not.toContain("pds.example");
});

test("signed_out_ignores_scope_everywhere", async () => {
  const { send } = setup({ session: null });
  const response = await send("/signed-out?scope=everywhere&error=logout.revoke_unconfirmed", { method: "GET" });
  const html = await response.text();
  expect(html).toContain("You are signed out");
  expect(html).not.toContain("every browser");
  expect(html).not.toContain("could not confirm the sign-in server ended access");
  // A known ?error= code is still the shell's callout.
  const shown = await setup({ session: null }).send("/signed-out?scope=all&error=login.failed", { method: "GET" });
  expect((await shown.text()).match(/Sign-in could not start/g)).toHaveLength(1);
});

test("signed_out_sends_a_signed_in_visitor_to_the_profile_resolver", async () => {
  // A browser that is signed in again (Back after a new sign-in, or a typed URL) is not told it is signed out.
  const response = await setup().send("/signed-out", { method: "GET" });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/did");
  expect(response.headers.getSetCookie()).toEqual([]);
});

test("signed_out.signed_in_redirect_clears_the_carried_issuer", async () => {
  // Another tab signed in before this redirect arrived: the previous account's issuer must not outlive it.
  const response = await setup().send("/signed-out", { method: "GET", cookie: issuerCookie(FOREIGN_ISSUER) });
  expect(response.status).toBe(303);
  expect(response.headers.getSetCookie()).toEqual([CLEAR_ISSUER]);
});
