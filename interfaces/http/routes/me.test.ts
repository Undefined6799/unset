// P2.13 (routes/me.ts): the signed-in home. The session store and the handle check are P2.03's and P2.02's, tested
// against Postgres and a stand-in network in their own suites; here they return each case the page handles.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as web from "@unset/apps-web";
import type { Did, HandleVerdict } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { sessionClearCookie } from "../session-cookie.ts";
import { webTestEnv } from "../test-env.ts";
import { pageResponse } from "../web/page.ts";
import { type MeDeps, meRoutes } from "./me.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

function setup(world: { session?: Session | null; clearCookie?: boolean; verdict?: HandleVerdict } = {}) {
  const checked: string[] = [];
  const log = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
  const deps: MeDeps = {
    open: async () => {
      const session = world.session === undefined ? SESSION : world.session;
      if (session === null) {
        const headers = new Headers({ location: "/login?next=%2Fme", "cache-control": "no-store" });
        if (world.clearCookie) headers.append("set-cookie", sessionClearCookie());
        return new Response(null, { status: 303, headers });
      }
      return { session, privacyNotice: false };
    },
    verifyHandle: async (did) => {
      checked.push(did);
      return world.verdict ?? { status: "verified", handle: "alice.pds.unset.test" as never, checkedAt: 0 };
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
  };
  const server = createServer({ config: CONFIG, routes: meRoutes(deps), policies, log });
  const get = () =>
    server.request(
      new Request(`${ORIGIN}/me`, {
        headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1", cookie: "__Host-sid=x" },
      }),
      "10.0.0.1",
    );
  return { get, checked };
}

describe("GET /me", () => {
  test("me_renders_the_signed_in_account", async () => {
    const { get, checked } = setup();
    const response = await get();
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("alice.pds.unset.test");
    expect(html).toContain(`<code>${DID}</code>`);
    expect(checked).toEqual([DID]);
  });

  test("me_no_cache", async () => {
    const response = await setup().get();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  test("me_handle_unavailable", async () => {
    const html = await (await setup({ verdict: { status: "unavailable" } }).get()).text();
    expect(html).toContain("handle.invalid");
    expect(html).toContain(`<code>${DID}</code>`);
    expect(html).toContain("We could not check your handle just now");
  });

  test("me_handle_invalid", async () => {
    const html = await (await setup({ verdict: { status: "invalid", checkedAt: 0 } }).get()).text();
    expect(html).toContain("handle.invalid");
    expect(html).not.toContain("could not check");
  });

  test("me_clears_a_dead_session_cookie", async () => {
    const response = await setup({ session: null, clearCookie: true }).get();
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toContain("__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  test("me_guards_signed_out", async () => {
    const { get, checked } = setup({ session: null });
    const response = await get();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fme");
    expect(checked).toEqual([]);
  });
});
