// P1.20b: the request gate of the SvelteKit web process, checked on the built server (ADR 0054, ADR 0056). These are
// the outcomes shared/http/server.ts gives the Hono server today, grouped as a reader looks for them; each page slice
// adds its own file beside this one. Postgres as `web` (TE-2); nothing is stood in. The routes under /test-routes/
// exist for this file and are served only when TEST_ROUTES is on (interfaces/web/src/routes/test-routes/README.md).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "./built-server.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const ROUTES = join(REPO, "interfaces", "web", "src", "routes");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };

const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-gate-test",
  max: 2,
  connectTimeoutMs: 5000,
});
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});

const did = (text: string): Did => {
  const parsed = parseDid(text);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
};
// A session needs its DID's stored grant (migration: app.session's foreign key to the token set). The gate never reads
// the grant, so it is sealed with a key made here; P1.20e's tests sign in for real.
const tokenSets = createOAuthSessionStore<SavedSession>({
  pool,
  sealer: createSealer(keyring()),
  log: quiet,
});
const ISSUER = "https://pds.unset.test";

function keyring() {
  const parsed = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }));
  if (parsed === undefined) throw new Error("test keyring did not parse");
  return parsed;
}

/** A signed-in browser for `owner`: a stored grant, then a session; returns the cookie value. */
async function signedIn(owner: Did): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(owner, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: ISSUER,
      sub: owner as SavedSession["tokenSet"]["sub"],
      aud: ISSUER,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  return (await withTransaction(pool, null, (tx) => sessions.create(tx, owner))).cookieValue;
}

let web: RunningWeb;
beforeAll(async () => {
  buildOnce();
  web = await startWeb(pg);
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await pool.end();
});

/** A form post from our own origin, from `from` (a client address the edge names). */
/** A fresh client address, so a test never shares the unknown-address bucket (shared/http rateLimit.ts). */
const from = (): Record<string, string> => ({ "x-forwarded-for": clientAddress() });
const formPost = (path: string, body: string, from = clientAddress(), headers: Record<string, string> = {}) =>
  web.fetch(path, {
    method: "POST",
    body,
    headers: {
      origin: ORIGIN,
      accept: "text/html", // a browser's form post with no script; an enhanced one asks for JSON
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": from,
      ...headers,
    },
  });

describe("hosts and headers", () => {
  test("only_our_hosts_are_served_files_included", async () => {
    expect((await web.fetch("/test-routes/plain-page", { headers: { host: "evil.test" } })).status).toBe(421);
    expect((await web.fetch("/_app/version.json", { headers: { host: "evil.test" } })).status).toBe(421);
    expect((await web.fetch("/_app/version.json")).status).toBe(200);
  });

  test("every_response_carries_the_security_headers", async () => {
    for (const path of ["/_app/version.json", "/nope", "/test-routes/plain-page", "/test-routes/fails"]) {
      const response = await web.fetch(path);
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("strict-transport-security"), path).toBe("max-age=63072000; includeSubDomains");
      expect(response.headers.get("content-security-policy"), path).not.toBeNull();
      expect(response.headers.get("x-sveltekit-page"), path).toBeNull();
    }
  });

  test("a_refusal_sveltekit_sends_before_the_hook_has_the_headers", async () => {
    const response = await formPost("/test-routes/form-post", "text=a", clientAddress(), {
      origin: "https://evil.test",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe("csp", () => {
  test("app_page_has_the_adr_0054_policy_with_path_sources", async () => {
    const csp = (await web.fetch("/test-routes/form-post")).headers.get("content-security-policy") ?? "";
    expect(csp.replace(/'sha256-[A-Za-z0-9+/=]+'/, "'sha256-<startup script>'")).toBe(
      "default-src 'none'; connect-src 'self'; font-src https://unset.test/fonts/; img-src 'self'; " +
        "manifest-src 'self'; object-src 'none'; script-src https://unset.test/_app/ 'sha256-<startup script>'; " +
        "style-src https://unset.test/_app/; style-src-attr 'unsafe-hashes' " +
        "'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=' 'sha256-VLgFcXpEe+O6FcWgF9ZsmG0zmp66HOx0AKvg+TMAbTo='; " +
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; " +
        "trusted-types svelte-trusted-html sveltekit-trusted-url",
    );
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  test("a_page_that_runs_no_script_allows_none", async () => {
    const response = await web.fetch("/test-routes/plain-page");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("script-src");
    expect(await response.text()).not.toContain("<script");
  });
});

describe("requests", () => {
  test("only_form_bodies_are_accepted", async () => {
    const json = await formPost("/test-routes/form-post", "{}", clientAddress(), {
      "content-type": "application/json",
    });
    expect(json.status).toBe(415);
    expect((await formPost("/test-routes/form-post", "text=abc")).status).toBe(200);
  });

  test("a_body_over_the_route_limit_is_refused", async () => {
    expect((await formPost("/test-routes/form-post", `text=${"a".repeat(2_000)}`)).status).toBe(413);
  });

  test("only_get_head_and_post_are_allowed", async () => {
    const response = await web.fetch("/test-routes/form-post", {
      method: "PUT",
      body: "text=a",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    });
    expect(response.status).toBe(405);
  });

  test("a_route_that_takes_no_body_refuses_a_post", async () => {
    expect((await formPost("/test-routes/plain-page", "text=a")).status).toBe(405);
  });
});

describe("limits", () => {
  test("a_client_address_over_its_limit_gets_429", async () => {
    const from = clientAddress();
    const statuses: number[] = [];
    for (let i = 0; i < 62; i += 1) {
      statuses.push((await web.fetch("/test-routes/plain-page", { headers: { "x-forwarded-for": from } })).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Another address is not held back by the first one's limit.
    expect(
      (await web.fetch("/test-routes/plain-page", { headers: { "x-forwarded-for": clientAddress() } })).status,
    ).toBe(200);
  });

  test("a_member_over_their_limit_gets_429_whatever_their_address", async () => {
    const cookie = `__Host-sid=${await signedIn(did(`did:plc:${"d".repeat(24)}`))}`;
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      statuses.push((await formPost("/test-routes/members", "x=1", clientAddress(), { cookie })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("session", () => {
  test("a_signed_in_page_sends_a_visitor_to_login", async () => {
    const response = await web.fetch("/test-routes/members");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Ftest-routes%2Fmembers");
  });

  test("a_page_with_a_parameter_returns_to_its_fixed_path_never_the_request", async () => {
    const response = await web.fetch("/test-routes/members/abc?next=//evil.test", { headers: from() });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Ftest-routes%2Fmembers");
  });

  test("a_page_members_write_is_read_by_visitors_and_written_only_with_a_session", async () => {
    const read = await web.fetch("/test-routes/writes/abc", { headers: from() });
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("visitor");
    const visitorWrite = await formPost("/test-routes/writes/abc?/save", "x=1");
    expect(visitorWrite.status).toBe(303);
    expect(visitorWrite.headers.get("location")).toBe("/login?next=%2Ftest-routes%2Fmembers");
    const cookie = `__Host-sid=${await signedIn(did(`did:plc:${"e".repeat(24)}`))}`;
    expect((await formPost("/test-routes/writes/abc?/save", "x=1", clientAddress(), { cookie })).status).toBe(200);
  });

  test("a_members_writes_count_against_the_write_limit", async () => {
    const cookie = `__Host-sid=${await signedIn(did(`did:plc:${"f".repeat(24)}`))}`;
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      statuses.push((await formPost("/test-routes/writes/abc?/save", "x=1", clientAddress(), { cookie })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Reading the page is not a write: the member's write limit does not hold it back.
    expect((await web.fetch("/test-routes/writes/abc", { headers: { cookie, ...from() } })).status).toBe(200);
  });

  test("an_app_page_wears_the_chosen_theme_and_a_public_one_never_reads_it", async () => {
    const page = (path: string, cookie: string) => web.fetch(path, { headers: { cookie, ...from() } });
    const dark = await (await page("/test-routes/form-post", "__Host-theme=dark")).text();
    expect(dark).toContain('<html lang="en" data-theme="dark">');
    expect(dark).toContain('<meta name="color-scheme" content="dark" />');
    for (const junk of ["__Host-theme=%22%3E", "__Host-theme=dark; __Host-theme=light"]) {
      const body = await (await page("/test-routes/form-post", junk)).text();
      expect(body).toContain('<html lang="en">');
      expect(body).toContain('content="dark light"');
    }
    const open = await (await page("/test-routes/plain-page", "__Host-theme=dark")).text();
    expect(open).toContain('<html lang="en">');
    expect(open).not.toContain("%unset.");
  });

  test("an_app_page_is_private_and_varies_on_cookie_a_public_one_is_not", async () => {
    const app = await web.fetch("/test-routes/form-post", { headers: from() });
    expect(app.headers.get("cache-control")).toBe("private, no-store");
    expect(app.headers.get("vary")).toContain("Cookie");
    const open = await web.fetch("/test-routes/plain-page", { headers: from() });
    expect(open.headers.get("cache-control")).toBeNull();
    expect(open.headers.get("vary") ?? "").not.toContain("Cookie");
  });

  test("a_signed_in_write_without_a_session_goes_to_sign_in", async () => {
    const response = await formPost("/test-routes/members", "x=1");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Ftest-routes%2Fmembers");
    // The same post enhanced by SvelteKit's client gets the redirect as JSON its client follows (kit actions.js).
    const enhanced = await formPost("/test-routes/members", "x=1", clientAddress(), {
      accept: "application/json",
      "x-sveltekit-action": "true",
    });
    expect(await enhanced.json()).toEqual({
      type: "redirect",
      status: 303,
      location: "/login?next=%2Ftest-routes%2Fmembers",
    });
  });

  test("a_session_reaches_the_page", async () => {
    const cookie = `__Host-sid=${await signedIn(did(`did:plc:${"a".repeat(24)}`))}`;
    const response = await web.fetch("/test-routes/members", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("signed in");
  });

  test("two_session_cookies_are_neither_trusted", async () => {
    const one = await signedIn(did(`did:plc:${"b".repeat(24)}`));
    const two = await signedIn(did(`did:plc:${"c".repeat(24)}`));
    const response = await web.fetch("/test-routes/members", {
      headers: { cookie: `__Host-sid=${one}; __Host-sid=${two}` },
    });
    expect(response.status).toBe(303);
  });

  test("a_page_with_no_script_reads_no_session", async () => {
    const response = await web.fetch("/test-routes/plain-page", {
      headers: { cookie: `__Host-sid=${"x".repeat(43)}`, ...from() },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("an_unknown_cookie_is_cleared_host_only", async () => {
    const response = await web.fetch("/test-routes/members", { headers: { cookie: `__Host-sid=${"x".repeat(43)}` } });
    const cleared = response.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/^__Host-sid=;/);
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("HttpOnly");
    expect(cleared.toLowerCase()).not.toContain("domain=");
  });
});

describe("deadline and errors", () => {
  test("a_route_past_its_deadline_gets_503", async () => {
    const response = await web.fetch("/test-routes/waits");
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("http.deadline\n");
  });

  test("an_error_shows_a_code_never_its_message", async () => {
    const response = await web.fetch("/test-routes/fails");
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("internal.error");
    expect(body).not.toContain("must never see");
  });

  test("test_routes_are_404_unless_turned_on", async () => {
    const off = await startWeb(pg, { TEST_ROUTES: "false" });
    try {
      expect((await off.fetch("/test-routes/plain-page")).status).toBe(404);
    } finally {
      await off.stop();
    }
  });
});

describe("policies and logs", () => {
  /** Every folder under src/routes holding a +page or +server file. */
  function routeFolders(dir = ROUTES): string[] {
    const here = readdirSync(dir);
    const nested = here
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .flatMap((name) => routeFolders(join(dir, name)));
    return here.some((name) => /^\+(page|server)\b/.test(name)) ? [dir, ...nested] : nested;
  }

  test("every_route_has_a_policy", () => {
    const missing = routeFolders().filter((dir) => !readdirSync(dir).includes("policy.ts"));
    expect(missing.map((dir) => relative(ROUTES, dir))).toEqual([]);
  });

  test("the_build_holds_no_prerendered_page", () => {
    const prerendered = join(REPO, "interfaces", "web", "build", "prerendered");
    expect(() => readdirSync(prerendered)).toThrow();
  });

  test("every_response_is_logged_without_address_or_account", async () => {
    await web.fetch("/_app/version.json", { headers: { "x-forwarded-for": "203.0.113.9" } });
    const lines = web.logs().filter((line) => line.event === "http.request");
    expect(lines.length).toBeGreaterThan(0);
    const text = JSON.stringify(web.logs());
    expect(text).not.toContain("203.0.113.9");
    expect(text).not.toContain("did:plc:");
    expect(text).not.toContain("must never see");
  });

  test("stand_ins_are_refused_outside_the_test_profile", async () => {
    const started = startWeb(pg, { UNSET_ENV: "dev", TEST_ROUTES: "false" }, {});
    const failure = await started.then(
      () => "listened",
      (error: unknown) => String(error),
    );
    expect(failure).toContain("exited before listening");
    expect(failure).not.toContain("config.invalid");
  });

  test("the_process_drains_and_exits_0", async () => {
    const other = await startWeb(pg);
    expect(await other.stop()).toBe(0);
  });
});
