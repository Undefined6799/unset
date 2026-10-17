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
import { pageResponse } from "../web/page.ts";
import { type LogoutDeps, logoutRoutes } from "./logout.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

function setup(world: { session?: Session | null; destroyFails?: boolean; remaining?: number } = {}) {
  const destroyed: Session[] = [];
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "http",
    commit: "c".repeat(40),
    env: "test",
    write: (l) => lines.push(JSON.parse(l)),
  });
  const deps: LogoutDeps = {
    readSession: async () => (world.session === undefined ? SESSION : world.session),
    destroySession: async (session) => {
      if (world.destroyFails) throw new Error("db down");
      destroyed.push(session);
      // Another browser still holds a session, so this path must not revoke the shared grant.
      return world.remaining ?? 1;
    },
    destroyAllSessions: async () => {
      throw new Error("everywhere is not this test");
    },
    revokeGrant: async () => {
      throw new Error("revoke is not this test");
    },
    deleteTokenSet: async () => {
      throw new Error("token delete is not this test");
    },
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
    pdsHost: "pds.unset.test",
    log,
  };
  const server = createServer({ config: CONFIG, routes: logoutRoutes(deps), policies, log });
  const send = (path: string, init: { method?: string; site?: "same-origin" | "cross-site"; body?: string } = {}) => {
    const method = init.method ?? "POST";
    const headers = new Headers({ host: "unset.test", "x-forwarded-for": "192.0.2.1", cookie: "__Host-sid=x" });
    if (method === "GET") return server.request(new Request(`${ORIGIN}${path}`, { headers }), "10.0.0.1");
    const site = init.site ?? "same-origin";
    headers.set("content-type", "application/x-www-form-urlencoded");
    headers.set("sec-fetch-site", site);
    headers.set("origin", site === "same-origin" ? ORIGIN : "https://evil.example");
    return server.request(new Request(`${ORIGIN}${path}`, { method, headers, body: init.body ?? "" }), "10.0.0.1");
  };
  return { send, destroyed, lines };
}

const SIGNED_OUT = [
  "__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
  "__Host-oauth_nonce=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
  "__Host-login_target=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
  "__Host-signed_out=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
];

describe("POST /logout", () => {
  test("logout_this_browser", async () => {
    const { send, destroyed, lines } = setup();
    const response = await send("/logout");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual(SIGNED_OUT);
    expect(destroyed).toEqual([SESSION]);
    expect(lines.filter((line) => line.event === "auth.logout_this_browser")).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain(DID);
  });

  test("logout_no_session_idempotent", async () => {
    const { send, destroyed } = setup({ session: null });
    const response = await send("/logout");
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.getSetCookie()).toEqual(SIGNED_OUT);
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

describe("POST /logout/everywhere", () => {
  test("logout_everywhere_requires_confirm", async () => {
    const { send, destroyed } = setup();
    const response = await send("/logout/everywhere");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings?error=logout.confirm_required");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(destroyed).toEqual([]);
  });

  test("logout_everywhere_get_405", async () => {
    const { send, destroyed } = setup();
    expect((await send("/logout/everywhere", { method: "GET" })).status).toBe(405);
    expect(destroyed).toEqual([]);
  });

  test("logout_everywhere_csrf", async () => {
    const { send, destroyed } = setup();
    expect((await send("/logout/everywhere", { site: "cross-site", body: "confirm=yes" })).status).toBe(403);
    expect(destroyed).toEqual([]);
  });

  test("logout_everywhere_no_session_idempotent", async () => {
    const { send, destroyed } = setup({ session: null });
    const response = await send("/logout/everywhere");
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.getSetCookie()).toEqual(SIGNED_OUT);
    expect(destroyed).toEqual([]);
  });
});

test("signed_out_page", async () => {
  const { send } = setup({ session: null });
  const response = await send("/signed-out", { method: "GET" });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("You are signed out");
  expect(html).toContain('href="https://pds.unset.test/account"');
});

test("signed_out_everywhere_names_an_unconfirmed_revoke", async () => {
  const { send } = setup({ session: null });
  const response = await send("/signed-out?scope=everywhere&error=logout.revoke_unconfirmed", { method: "GET" });
  const html = await response.text();
  expect(html).toContain("every browser");
  expect(html).toContain("could not confirm the sign-in server ended access");
  // A crafted scope or error is not a sentence.
  const ignored = await setup({ session: null }).send("/signed-out?scope=all&error=login.failed", { method: "GET" });
  const quiet = await ignored.text();
  expect(quiet).not.toContain("every browser");
  expect(quiet).not.toContain("Sign-in could not start");
});

test("signed_out_sends_a_signed_in_visitor_to_me", async () => {
  // A browser that is signed in again (Back after a new sign-in, or a typed URL) is not told it is signed out.
  const response = await setup().send("/signed-out", { method: "GET" });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/me");
});
