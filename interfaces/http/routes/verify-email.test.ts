// P2.11 (routes/verify-email.ts): the page reads a fake PDS answer. The real pdsSessionInfo is tested in
// infrastructure/pds. This file checks the states, that a query cannot confirm the email, and that GET does not send mail.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as web from "@unset/apps-web";
import { type Did, type OnboardingAccount, PRIVACY_VERSION, TERMS_VERSION } from "@unset/domains-identity";
import type { PdsResult, SessionInfo } from "@unset/infrastructure-pds";
import type { Session } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { afterAll, describe, expect, test } from "vitest";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { silentLog, testPage } from "../web/fixtures/page.ts";
import { verifyEmailRoutes } from "./verify-email.ts";

const ORIGIN = "https://unset.test";
const DID = `did:plc:${"a".repeat(24)}` as Did;
const SESSION: Session = { did: DID, idHash: Buffer.alloc(32, 7), createdAt: new Date(0), emailConfirmed: null };
const SECRETS = mkdtempSync(join(tmpdir(), "verify-email-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN }));

function info(emailConfirmed: boolean | undefined): PdsResult<SessionInfo> {
  const value: SessionInfo = { handle: "alice.test" };
  if (emailConfirmed === undefined) return { kind: "ok", value };
  return { kind: "ok", value: { ...value, emailConfirmed } };
}

const DONE: OnboardingAccount = {
  onboarding: "done",
  termsVersion: TERMS_VERSION,
  privacyVersion: PRIVACY_VERSION,
};

function setup(
  world: { session?: Session | null; info?: PdsResult<SessionInfo>; account?: OnboardingAccount | null } = {},
) {
  const saved: boolean[] = [];
  const calls: string[] = [];
  const authorized: { prompt?: string; input: string }[] = [];
  const log = silentLog();
  const server = createServer({
    config: CONFIG,
    routes: verifyEmailRoutes({
      readSession: async () => (world.session === undefined ? SESSION : world.session),
      loadAccount: async () => (world.account === undefined ? DONE : world.account),
      versions: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION },
      setEmailConfirmed: async (_id, value) => {
        saved.push(value);
      },
      sessionInfo: async () => {
        calls.push("getSession");
        return world.info ?? info(false);
      },
      issueNonce: async () => "n".repeat(43),
      authorize: async (input, options) => {
        authorized.push({ input, ...(options.prompt ? { prompt: options.prompt } : {}) });
        return { ok: true, url: new URL("https://pds.unset.test/oauth/authorize") };
      },
      safeHref: (value) => value as never,
      allowHttp: false,
      page: testPage(log),
      screens: web.screens,
      pdsHost: "pds.unset.test",
      log,
    }),
    policies,
    log,
  });
  const send = (path: string, method = "GET", body = "") => {
    const headers = new Headers({ host: "unset.test", "x-forwarded-for": "192.0.2.1", cookie: "__Host-sid=x" });
    if (method === "GET") return server.request(new Request(`${ORIGIN}${path}`, { headers }), "10.0.0.1");
    headers.set("content-type", "application/x-www-form-urlencoded");
    headers.set("sec-fetch-site", "same-origin");
    headers.set("origin", ORIGIN);
    return server.request(new Request(`${ORIGIN}${path}`, { method, headers, body }), "10.0.0.1");
  };
  return { send, saved, calls, authorized };
}

describe("GET /verify-email", () => {
  test("verify.confirmed", async () => {
    const { send, saved } = setup({ info: info(true) });
    const response = await send("/verify-email?confirmed=1");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Your email is confirmed");
    expect(html).toContain('href="/did"');
    expect(saved).toEqual([true]);
  });

  test("verify.unconfirmed", async () => {
    const { send, saved } = setup({ info: info(false) });
    const html = await (await send("/verify-email")).text();
    expect(html).toContain("our sign-in server; it is the only place you type your password");
    expect(html).toContain('href="https://pds.unset.test/account"');
    expect(html).toContain("confirmed it — check again");
    expect(saved).toEqual([false]);
  });

  test("verify.needs_consent", async () => {
    const { send } = setup({ info: info(undefined) });
    const html = await (await send("/verify-email")).text();
    expect(html).toContain('action="/verify-email/reconsent"');
    expect(html).not.toContain("requestEmailConfirmation");
  });

  test("verify.query_ignored", async () => {
    const { send } = setup({ info: info(false) });
    const html = await (await send("/verify-email?confirmed=1")).text();
    expect(html).toContain("Confirm your email in the new tab");
    expect(html).not.toContain("Your email is confirmed");
  });

  test("verify.no_send_on_get", async () => {
    const { send, calls } = setup({ info: info(false) });
    await send("/verify-email");
    expect(calls).toEqual(["getSession"]);
  });

  test("verify.transient", async () => {
    const { send, saved } = setup({ info: { kind: "transient", code: "pds_unavailable" } });
    const response = await send("/verify-email");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("is not answering");
    expect(saved).toEqual([]);
  });

  test("verify.onboarding_required", async () => {
    const { send, calls } = setup({ account: { onboarding: "age", termsVersion: null, privacyVersion: null } });
    const response = await send("/verify-email");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/welcome");
    expect(calls).toEqual([]);
  });

  test("verify_no_session", async () => {
    const { send, calls } = setup({ session: null });
    const response = await send("/verify-email");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fverify-email");
    expect(calls).toEqual([]);
  });
});

test("verify.needs_consent posts reconsent", async () => {
  const { send, authorized } = setup({ info: { kind: "scope_missing" } });
  const response = await send("/verify-email/reconsent", "POST");
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/login/continue");
  expect(authorized).toEqual([{ input: DID, prompt: "consent" }]);
  const cookies = response.headers.getSetCookie().join("\n");
  expect(cookies).toContain("__Host-oauth_nonce=");
  expect(cookies).not.toContain("Domain=");
});
