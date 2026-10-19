// P2.06 (routes/oauth-callback.ts): GET /oauth/callback behind the server kit, where a grant becomes a session. The
// library's side (state, iss, code exchange, sub check) is completeAuthorization, tested against a stand-in server in
// infrastructure/pds; here it is a double returning each outcome. The nonce and session stores are P1.16's and
// P2.03's, tested against Postgres in tests/integration; here they record what the route asks of them, in order.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Did } from "@unset/domains-identity";
import { type CallbackResult, SCOPE_METADATA } from "@unset/infrastructure-pds";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { type CallbackDeps, oauthCallbackRoutes } from "./oauth-callback.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const OTHER = `did:plc:${"b".repeat(24)}` as Did;
const NONCE = "n".repeat(43);
const SID = "s".repeat(43);
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));
const QUERY = "?state=st&code=c&iss=https%3A%2F%2Fpds.unset.test";

const appState = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, nonce: NONCE, flow: "login", expectedDid: DID, next: null, startedAt: 1, ...fields });

type World = {
  /** What completeAuthorization returns; a successful completion for DID by default. */
  completed?: Partial<Extract<CallbackResult, { ok: true }>> | Extract<CallbackResult, { ok: false }>;
  consumed?: "ok" | "invalid" | "throws";
  createFails?: boolean;
};

function setup(world: World = {}) {
  const calls: string[] = [];
  const created: { did: Did; replacing: string | null }[] = [];
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "http",
    commit: "c".repeat(40),
    env: "test",
    write: (l) => lines.push(JSON.parse(l)),
  });
  const deps: CallbackDeps = {
    complete: async (query) => {
      calls.push(`complete ${query.get("state")}`);
      const completed = world.completed ?? {};
      if ("reason" in completed) return completed;
      return {
        ok: true,
        did: DID,
        issuer: "https://pds.unset.test",
        appState: appState(),
        scope: SCOPE_METADATA,
        revoke: async () => void calls.push("revoke"),
        ...completed,
      };
    },
    consumeNonce: async (nonce) => {
      calls.push(`consume ${nonce}`);
      if (world.consumed === "throws") throw new Error("db down");
      return world.consumed ?? "ok";
    },
    createSession: async (did, replacing) => {
      calls.push("create");
      if (world.createFails) throw new Error("db down");
      created.push({ did, replacing });
      return { cookieValue: SID, expiresAt: new Date(Date.now() + 1000) };
    },
    sessionMaxAgeS: 2_592_000,
    log,
  };
  const server = createServer({ config: CONFIG, routes: oauthCallbackRoutes(deps), policies, log });
  const send = (cookie?: string, query = QUERY) => {
    const headers = new Headers({ host: "unset.test", "x-forwarded-for": "192.0.2.1" });
    if (cookie !== undefined) headers.set("cookie", cookie);
    return server.request(new Request(`${ORIGIN}/oauth/callback${query}`, { headers }), "10.0.0.1");
  };
  return { send, calls, created, lines, routes: server.routeTable() };
}

const NONCE_COOKIE = `__Host-oauth_nonce=${NONCE}`;
const CLEAR_NONCE = "__Host-oauth_nonce=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0";
const location = (response: Response) => response.headers.get("location");
const cookies = (response: Response) => response.headers.getSetCookie();
const events = (lines: Record<string, unknown>[]) => lines.filter((line) => String(line.event).startsWith("auth."));

describe("GET /oauth/callback", () => {
  test("callback_success_creates_session", async () => {
    const { send, calls, created, lines } = setup();
    const response = await send(NONCE_COOKIE);
    expect(response.status).toBe(303);
    expect(location(response)).toBe("/did");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual(["complete st", `consume ${NONCE}`, "create"]);
    expect(created).toEqual([{ did: DID, replacing: null }]);
    expect(cookies(response)).toEqual([
      CLEAR_NONCE,
      "__Host-signed_out=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
      `__Host-sid=${SID}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    ]);
    expect(events(lines).map((line) => line.event)).toEqual(["auth.login_succeeded"]);
    expect(JSON.stringify(lines)).not.toContain(DID);
  });

  test("callback_follows_a_valid_next", async () => {
    const valid = setup({ completed: { appState: appState({ next: "/settings/profile" }) } });
    expect(location(await valid.send(NONCE_COOKIE))).toBe("/settings/profile");
    const profile = setup({ completed: { appState: appState({ next: `/${DID}` }) } });
    expect(location(await profile.send(NONCE_COOKIE))).toBe(`/${DID}`);
    const legacy = setup({ completed: { appState: appState({ next: "/me" }) } });
    expect(location(await legacy.send(NONCE_COOKIE))).toBe("/me");
    const offsite = setup({ completed: { appState: appState({ next: "//evil.example" }) } });
    expect(location(await offsite.send(NONCE_COOKIE))).toBe("/did");
  });

  test("callback_no_cookie_or_cookie_mismatch", async () => {
    for (const cookie of [undefined, `__Host-oauth_nonce=${"m".repeat(43)}`, `${NONCE_COOKIE}; ${NONCE_COOKIE}`]) {
      const { send, calls, lines } = setup();
      const response = await send(cookie);
      expect(location(response), String(cookie)).toBe("/login?error=login.state_mismatch");
      // Nothing consumed, no session, and the cookie stays: another tab's flow may still own it.
      expect(calls).toEqual(["complete st"]);
      expect(cookies(response)).toEqual([]);
      expect(events(lines)).toEqual([
        expect.objectContaining({ event: "auth.login_denied", code: "login.state_mismatch" }),
      ]);
    }
  });

  test("callback_library_failures_keep_the_nonce", async () => {
    for (const reason of ["expired", "consent_denied", "pds_unreachable", "failed"] as const) {
      const { send, calls } = setup({ completed: { ok: false, reason } });
      const response = await send(NONCE_COOKIE);
      expect(location(response)).toBe(`/login?error=login.${reason}`);
      expect(calls).toEqual(["complete st"]);
      expect(cookies(response)).toEqual([]);
    }
  });

  test("callback_nonce_already_spent", async () => {
    const { send, calls } = setup({ consumed: "invalid" });
    const response = await send(NONCE_COOKIE);
    expect(location(response)).toBe("/login?error=login.expired");
    expect(calls).toEqual(["complete st", `consume ${NONCE}`]);
  });

  test("callback_nonce_store_down", async () => {
    const { send, calls } = setup({ consumed: "throws" });
    expect(location(await send(NONCE_COOKIE))).toBe("/login?error=login.failed");
    expect(calls).not.toContain("create");
  });

  test("callback_appstate_malformed", async () => {
    const shapes = [
      "not json",
      "null",
      appState({ v: 2 }),
      appState({ nonce: "short" }),
      appState({ flow: "other" }),
      appState({ expectedDid: "alice" }),
    ];
    for (const shape of shapes) {
      const { send, calls } = setup({ completed: { appState: shape } });
      expect(location(await send(NONCE_COOKIE)), shape).toBe("/login?error=login.failed");
      expect(calls).toEqual(["complete st"]);
    }
  });

  test("callback_expected_account", async () => {
    const { send, calls } = setup({ completed: { did: OTHER } });
    const response = await send(NONCE_COOKIE);
    expect(location(response)).toBe("/login?error=login.account_mismatch");
    // The nonce is spent and its cookie cleared; the grant stays for that account's other browsers.
    expect(calls).toEqual(["complete st", `consume ${NONCE}`]);
    expect(cookies(response)).toEqual([CLEAR_NONCE]);
    const chooser = setup({ completed: { did: OTHER, appState: appState({ expectedDid: null }) } });
    expect(location(await chooser.send(NONCE_COOKIE))).toBe("/did");
  });

  test("callback_scope_insufficient_revokes", async () => {
    const narrow = SCOPE_METADATA.replace(" account:email?action=read", "");
    const { send, calls } = setup({ completed: { scope: narrow } });
    const response = await send(NONCE_COOKIE);
    expect(location(response)).toBe("/login?error=login.scope_insufficient");
    expect(calls).toEqual(["complete st", `consume ${NONCE}`, "revoke"]);
  });

  test("callback_rotates_old_session", async () => {
    const { send, created } = setup();
    await send(`__Host-sid=${"o".repeat(43)}; ${NONCE_COOKIE}`);
    expect(created).toEqual([{ did: DID, replacing: "o".repeat(43) }]);
  });

  test("callback_db_failure", async () => {
    const { send, lines } = setup({ createFails: true });
    const response = await send(NONCE_COOKIE);
    expect(location(response)).toBe("/login?error=login.failed");
    expect(cookies(response).some((cookie) => cookie.startsWith("__Host-sid="))).toBe(false);
    expect(events(lines)).toEqual([expect.objectContaining({ event: "auth.login_denied", code: "login.failed" })]);
  });

  test("callback_listed_get_exception", () => {
    // The only GET route that mutates, allowed because P1.07 lists its path in GET_MUTATION_EXCEPTIONS.
    const { routes } = setup();
    const own = routes.filter((route) => route.path !== "/health");
    expect(own.map(({ method, path, mutates, group }) => ({ method, path, mutates, group }))).toEqual([
      { method: "GET", path: "/oauth/callback", mutates: true, group: "app" },
    ]);
  });
});
