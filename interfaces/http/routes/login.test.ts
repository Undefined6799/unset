// P2.05 (routes/login.ts): GET /login, POST /login and GET /login/continue behind the server kit's real checks (CSRF
// gate, rate limit, security headers), rendered by apps/web's screens. The handle lookup and the authorization server
// are network doubles; the nonce store is P1.16's, tested against Postgres in tests/integration/postgres/single-use,
// so here it is the counter the route must call before it starts any authorization.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as web from "@unset/apps-web";
import type { Handle, HandleResolution } from "@unset/domains-identity";
import type { AuthorizeResult } from "@unset/infrastructure-pds";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { pageResponse } from "../web/page.ts";
import { type LoginDeps, loginRoutes } from "./login.ts";
import { logoutRoutes } from "./logout.ts";

const ORIGIN = "https://unset.test";
const PDS = "pds-test.dev";
const DID = `did:plc:${"a".repeat(24)}`;
const AS_URL = `https://${PDS}/oauth/authorize?client_id=x&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Areq-1`;
const NONCE = "n".repeat(43);
const FORM = "application/x-www-form-urlencoded";
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

type World = {
  /** Whether the request carries a live session. */
  signedIn?: boolean;
  clearCookie?: boolean;
  resolution?: HandleResolution;
  authorized?: AuthorizeResult;
  allowHttp?: boolean;
};

/** The login routes on a kit server, with the network doubles recording what reached them. */
function setup(world: World = {}) {
  const resolved: string[] = [];
  const authorized: { input: string; appState: Record<string, unknown>; prompt?: string }[] = [];
  let nonces = 0;
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "http",
    commit: "c".repeat(40),
    env: "test",
    write: (l) => lines.push(JSON.parse(l)),
  });
  const deps: LoginDeps = {
    page: (page) =>
      pageResponse(
        {
          build: { manifest: { boot: "assets/boot.js", styles: [], fonts: [], islands: new Map() }, files: new Map() },
          render: web.renderPage,
          assetsOrigin: ORIGIN,
          env: "test",
          log,
        },
        page,
      ),
    screens: web.screens,
    safeHref: web.safeHref,
    readSession: async () => ({
      session: world.signedIn ? ({ did: DID } as Session) : null,
      clearCookie: world.clearCookie ?? false,
    }),
    resolveHandle: async (handle: Handle) => {
      resolved.push(handle);
      return world.resolution ?? { status: "found", did: DID as never, via: "dns" };
    },
    issueNonce: async () => {
      nonces += 1;
      return NONCE;
    },
    authorize: async (input, { appState, prompt }) => {
      authorized.push({ input, appState: JSON.parse(appState), ...(prompt ? { prompt } : {}) });
      return world.authorized ?? { ok: true, url: new URL(AS_URL) };
    },
    pdsHost: PDS,
    handleDomain: PDS,
    allowHttp: world.allowHttp ?? false,
    log,
  };
  // The real sign-out route beside sign-in, so a test can carry what logout sets into the next POST /login.
  const logout = logoutRoutes({
    readSession: async () => (world.signedIn ? ({ did: DID, idHash: Buffer.alloc(32, 7) } as Session) : null),
    destroySession: async () => 1,
    issuerOf: async () => `https://${PDS}`,
    revokeGrant: async () => undefined,
    deleteTokenSet: async () => undefined,
    page: deps.page,
    screens: web.screens,
    pdsIssuer: `https://${PDS}`,
    log,
  });
  const server = createServer({ config: CONFIG, routes: [...loginRoutes(deps), ...logout], policies, log });
  const send = (path: string, init: { form?: string; cookie?: string; site?: "same-origin" | "cross-site" } = {}) => {
    const headers = new Headers({ host: "unset.test", "x-forwarded-for": "192.0.2.1" });
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.form === undefined) return server.request(new Request(`${ORIGIN}${path}`, { headers }), "10.0.0.1");
    const site = init.site ?? "same-origin";
    headers.set("content-type", FORM);
    headers.set("sec-fetch-site", site);
    headers.set("origin", site === "same-origin" ? ORIGIN : "https://evil.example");
    return server.request(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: init.form }), "10.0.0.1");
  };
  return { send, resolved, authorized, nonces: () => nonces, lines };
}

const cookies = (response: Response) => response.headers.getSetCookie();
const location = (response: Response) => response.headers.get("location");
/** The target cookie a successful POST sets, as the browser sends it back. */
const targetCookie = (target: string) => `__Host-login_target=${Buffer.from(target).toString("base64url")}`;

describe("GET /login", () => {
  test("login_get_renders_no_state", async () => {
    const { send, nonces, authorized, resolved } = setup();
    const response = await send("/login?handle=alice&next=/me");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/name="handle"[^>]*value="alice"|value="alice"[^>]*name="handle"/);
    expect(html).toContain('<input type="hidden" name="next" value="/me"/>');
    expect(html).toContain(`Use ${PDS} sign-in`);
    expect(cookies(response)).toEqual([]);
    expect([nonces(), authorized.length, resolved.length]).toEqual([0, 0, 0]);
  });

  test("login_clears_a_dead_session_cookie", async () => {
    const response = await setup({ clearCookie: true }).send("/login");
    expect(response.headers.getSetCookie()).toContain("__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  test("login_signed_in_redirect", async () => {
    const { send } = setup({ signedIn: true });
    const response = await send("/login");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/did");
    // A sign-in that failed in a still-signed-in browser comes back with its error, and stays to show it.
    expect((await send("/login?error=login.consent_denied")).status).toBe(200);
  });

  test("login_get_drops_an_unsafe_next", async () => {
    const { send } = setup();
    for (const next of ["//evil.com", "/\t/evil.com", "javascript:alert(1)", "/login"]) {
      const html = await (await send(`/login?next=${encodeURIComponent(next)}`)).text();
      expect(html, next).not.toContain('name="next"');
    }
  });

  test("login_get_shows_only_a_catalog_error", async () => {
    const { send } = setup();
    const html = await (await send("/login?error=login.handle_not_found")).text();
    expect(html).toContain("No account uses that handle.");
    expect(html.match(/No account uses that handle\./g)).toHaveLength(1);
    expect(html).toContain('<main id="main">');
    expect(html.match(/<main/g)).toHaveLength(1);
    const forged = await (await send("/login?error=%3Cscript%3Ex")).text();
    expect(forged).not.toContain('role="alert"');
    expect(forged).not.toContain("<script>x");
  });
});

describe("POST /login", () => {
  test("login_post_handle", async () => {
    const { send, resolved, authorized } = setup();
    const response = await send("/login", { form: `handle=alice.${PDS}&intent=login` });
    expect(response.status).toBe(303);
    expect(location(response)).toBe("/login/continue");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(resolved).toEqual([`alice.${PDS}`]);
    expect(authorized).toHaveLength(1);
    expect(authorized[0]?.input).toBe(`alice.${PDS}`);
    expect(authorized[0]?.appState).toMatchObject({ v: 1, nonce: NONCE, flow: "login", expectedDid: DID, next: null });
    expect(typeof authorized[0]?.appState.startedAt).toBe("number");
    expect(cookies(response)).toEqual([
      `__Host-oauth_nonce=${NONCE}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
      `${targetCookie(AS_URL)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=120`,
    ]);
  });

  test("login_post_short_handle_appends_domain", async () => {
    const { send, resolved } = setup();
    await send("/login", { form: "handle=alice" });
    await send("/login", { form: `handle=${encodeURIComponent("  @Alice.Example.COM ")}` });
    expect(resolved).toEqual([`alice.${PDS}`, "alice.example.com"]);
  });

  test("login_post_did", async () => {
    const { send, resolved, authorized } = setup();
    expect(location(await send("/login", { form: `handle=${DID}` }))).toBe("/login/continue");
    expect(resolved).toEqual([]);
    expect(authorized.map((a) => [a.input, a.appState.expectedDid])).toEqual([[DID, DID]]);
  });

  test("login_post_chooser", async () => {
    const { send, resolved, authorized } = setup();
    await send("/login", { form: "handle=&intent=login" });
    await send("/login", { form: "handle=alice&intent=chooser" });
    expect(resolved).toEqual([]);
    expect(authorized.map((a) => [a.input, a.appState.expectedDid])).toEqual([
      [`https://${PDS}`, null],
      [`https://${PDS}`, null],
    ]);
  });

  test("login_handle_errors_issue_no_nonce", async () => {
    const cases: [World, string, string][] = [
      [{}, "handle=not%20a%20handle", "login.handle_invalid"],
      [{}, "handle=did:nope:x", "login.handle_invalid"],
      // DIDs are case-sensitive: an uppercase did:plc is refused, never lowercased into another account.
      [{}, `handle=did:plc:${"A".repeat(24)}`, "login.handle_invalid"],
      [{ resolution: { status: "not_found" } }, "handle=alice", "login.handle_not_found"],
      [{ resolution: { status: "unavailable" } }, "handle=alice", "login.identity_unavailable"],
    ];
    for (const [world, form, code] of cases) {
      const { send, nonces, authorized } = setup(world);
      const response = await send("/login", { form });
      expect(response.status, form).toBe(303);
      expect(location(response), form).toBe(`/login?error=${code}`);
      expect(cookies(response)).toEqual([]);
      expect([nonces(), authorized.length], form).toEqual([0, 0]);
    }
  });

  test("login_authorize_failure_returns_to_the_form", async () => {
    const { send, nonces } = setup({ authorized: { ok: false, reason: "pds_unreachable" } });
    const response = await send("/login", { form: "handle=alice&next=%2Fme" });
    expect(location(response)).toBe("/login?next=%2Fme&error=login.pds_unreachable");
    expect(cookies(response)).toEqual([]);
    // The nonce was issued before the server was asked; it never reaches a browser and expires in 10 minutes.
    expect(nonces()).toBe(1);
  });

  test("login_next_validated", async () => {
    const { send, authorized } = setup();
    for (const next of ["/me", "//evil.com", "/\t/evil.com", "javascript:alert(1)"]) {
      await send("/login", { form: `handle=alice&next=${encodeURIComponent(next)}` });
    }
    expect(authorized.map((a) => a.appState.next)).toEqual(["/me", null, null, null]);
  });

  test("login_refuses_a_non_https_target", async () => {
    const insecure = { ok: true, url: new URL(`http://${PDS}/oauth/authorize?x=1`) } as const;
    const { send, lines } = setup({ authorized: insecure });
    const response = await send("/login", { form: "handle=alice" });
    expect(location(response)).toBe("/login?error=login.failed");
    expect(cookies(response)).toEqual([]);
    expect(lines.some((line) => line.event === "oauth.authorize_failed" && line.kind === "insecure_target")).toBe(true);
    // A local stack that allows plain HTTP may continue to it.
    const local = setup({ authorized: insecure, allowHttp: true });
    expect(location(await local.send("/login", { form: "handle=alice" }))).toBe("/login/continue");
  });

  test("logout.next_login_prompt", async () => {
    // After a sign-out, the server asks for the password again rather than reusing its own session (P2.08). The
    // cookie is the one a real POST /logout sets, carried back as a browser would (P2.08b), not one written here.
    const signOut = await setup({ signedIn: true }).send("/logout", { form: "", cookie: "__Host-sid=x" });
    expect(location(signOut)).toBe("/signed-out");
    const jar = cookies(signOut)
      .map((line) => line.split(";")[0] ?? "")
      .filter((pair) => !pair.endsWith("="))
      .join("; ");
    expect(jar).toContain("__Host-signed_out=");
    const { send, authorized } = setup();
    await send("/login", { form: "handle=alice", cookie: jar });
    await send("/login", { form: "handle=alice" });
    expect(authorized.map((a) => a.prompt)).toEqual(["login", undefined]);
  });

  test("login_rate_limited", async () => {
    const { send, authorized } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await send("/login", { form: "handle=alice" })).status);
    expect(statuses.slice(0, 10).every((status) => status === 303)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(authorized).toHaveLength(10);
  });

  test("login_csrf_enforced", async () => {
    const { send, authorized, nonces } = setup();
    const response = await send("/login", { form: "handle=alice", site: "cross-site" });
    expect(response.status).toBe(403);
    expect([authorized.length, nonces()]).toEqual([0, 0]);
  });

  test("login_post_never_leaves_origin", async () => {
    const worlds: World[] = [
      {},
      { resolution: { status: "not_found" } },
      { authorized: { ok: false, reason: "failed" } },
    ];
    for (const world of worlds) {
      const response = await setup(world).send("/login", { form: "handle=alice" });
      expect(response.status).toBe(303);
      expect(location(response)).toMatch(/^\/(?!\/)/);
    }
  });
});

describe("GET /login/continue", () => {
  test("continue_renders_meta_refresh", async () => {
    const { send } = setup();
    const response = await send("/login/continue", { cookie: targetCookie(AS_URL) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const html = await response.text();
    expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${AS_URL.replace("&", "&amp;")}"/>`);
    expect(html).toContain(`Continue to ${PDS}`);
    expect(html).toContain("only place you type your password");
    expect(cookies(response)).toEqual([]);
  });

  test("continue_expired_or_unknown", async () => {
    const { send } = setup();
    for (const cookie of [
      undefined,
      "__Host-login_target=",
      "__Host-login_target=%%%",
      targetCookie("javascript:alert(1)"),
    ]) {
      const response = await send("/login/continue", cookie === undefined ? {} : { cookie });
      expect(response.status, String(cookie)).toBe(303);
      expect(location(response)).toBe("/login?error=login.expired");
    }
    // Two target cookies mean a confused or planted jar; neither is used.
    const two = `${targetCookie(AS_URL)}; ${targetCookie("https://other.example/x")}`;
    expect(location(await send("/login/continue", { cookie: two }))).toBe("/login?error=login.expired");
  });

  test("continue_refuses_plain_http_unless_allowed", async () => {
    const plain = targetCookie(`http://${PDS}/oauth/authorize?x=1`);
    expect(location(await setup().send("/login/continue", { cookie: plain }))).toBe("/login?error=login.expired");
    expect((await setup({ allowHttp: true }).send("/login/continue", { cookie: plain })).status).toBe(200);
  });

  test("continue_target_not_from_query", async () => {
    const { send } = setup();
    const response = await send("/login/continue?target=https://evil.example/&r=x", { cookie: targetCookie(AS_URL) });
    const html = await response.text();
    expect(html).not.toContain("evil.example");
    expect(html).toContain(`Continue to ${PDS}`);
  });

  test("continue_escapes_target", async () => {
    const { send } = setup();
    const html = await (await send("/login/continue", { cookie: targetCookie('https://a.example/x?q="<b>') })).text();
    expect(html).not.toContain('q="<b>');
    expect(html).toContain("q=%22%3Cb%3E");
  });
});

test("login_csp_app_group", async () => {
  const { send } = setup();
  for (const response of [await send("/login"), await send("/login/continue", { cookie: targetCookie(AS_URL) })]) {
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toMatch(/\shttps:(\s|;|$)/);
  }
});
