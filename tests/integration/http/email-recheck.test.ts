// P2.11a: a grant revoked at the PDS (its connected-apps page) ends our sessions at the next email recheck. Postgres as
// web with the real session store, token-set store and pdsCall (TE-2); only the OAuth client, the authorization server
// side, is a stand-in (an unmanaged dependency, TE-1). The bound this pins: other browsers keep rendering for at most
// EMAIL_RECHECK_S, capped at 900, or until the next PDS call.
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { createPdsCall, type PdsResult, type SessionInfo } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore, type Session } from "@unset/infrastructure-session";
import { defineConfig, loadConfig } from "@unset/shared-config";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeEach, expect, inject, test } from "vitest";
import { type AppGate, openApp } from "../../../interfaces/http/app-gate.ts";
import { loginConfig } from "../../../interfaces/http/config.ts";
import { emailRefresh } from "../../../interfaces/http/email-refresh.ts";
import { sessionClearCookie } from "../../../interfaces/http/session-cookie.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const pool = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "email-recheck-http",
  max: 4,
  connectTimeoutMs: 5000,
});
afterAll(() => pool.end());

const did = (text: string): Did => {
  const parsed = parseDid(text);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
};
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
let n = 0;
const newDid = (): Did => {
  const i = n++;
  return did(`did:plc:${"e".repeat(22)}${BASE32[i >> 5]}${BASE32[i & 31]}`);
};

const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 6).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const quiet = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
const tokenSets = createOAuthSessionStore({ pool, sealer: createSealer(keyring), log: quiet });
const store = createSessionStore({
  withDb: (deadline, fn) => withClient(pool, deadline, fn),
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(pool, null, async (client) => (await client.query<T>(text, values)).rows);
/** The web server's default, which the config now caps. */
const RECHECK_S = loadConfig(defineConfig({ EMAIL_RECHECK_S: loginConfig.EMAIL_RECHECK_S }), {}).EMAIL_RECHECK_S;

/** What the authorization server says when the client restores the grant. */
let grant: "revoked" | "pds_down" = "revoked";
let restores = 0;
/** Set for the scope case only, where the answer comes from the PDS response rather than the restore. */
let answer: PdsResult<SessionInfo> | undefined;
beforeEach(() => {
  grant = "revoked";
  restores = 0;
  answer = undefined;
});

const pds = createPdsCall({
  client: {
    restore: async () => {
      restores += 1;
      // oauth-server-agent.js:127 (@atproto/oauth-client 0.8.9) throws this when the grant no longer resolves to the
      // issuer it was made with; pds-errors.ts maps it to auth_dead without the SDK's own error classes.
      if (grant === "revoked") throw new TypeError("Issuer mismatch");
      throw Object.assign(new Error("lock"), { name: "LockTimeout" });
    },
  },
  endSessions: (owner) =>
    withTransaction(pool, null, (tx) => store.destroyAllForDid(tx, owner, "auth_dead")).then(() => undefined),
  tokenSetRemains: async (owner) => (await sql("SELECT 1 FROM app.oauth_session WHERE did = $1", [owner])).length === 1,
  log: quiet,
});

const sessionsOf = async (owner: Did) =>
  (await sql<{ n: number }>("SELECT count(*)::int AS n FROM app.session WHERE did = $1", [owner]))[0]?.n;
const hasToken = async (owner: Did) =>
  (await sql("SELECT 1 FROM app.oauth_session WHERE did = $1", [owner])).length === 1;

/** The gate compose builds, over the real stores; `afterS` is how long after the last check the request arrives. */
function gate(afterS: number): AppGate {
  return {
    readSession: (request, deadline) =>
      store.read({ key: request, cookieValue: request.headers.get("x-test-sid"), deadline }),
    loadAccount: async () => ({ onboarding: "done", termsVersion: "t", privacyVersion: "p" }),
    versions: { terms: "t", privacy: "p" },
    emailCache: async (session: Session) => {
      const [row] = await sql<{ email_confirmed: boolean | null; email_checked_at: Date | null }>(
        "SELECT email_confirmed, email_checked_at FROM app.session WHERE id_hash = $1 AND did = $2",
        [session.idHash, session.did],
      );
      return { confirmed: row?.email_confirmed ?? null, checkedAt: row?.email_checked_at ?? null };
    },
    refreshEmail: emailRefresh({
      sessionInfo: (owner, deadline) =>
        answer === undefined
          ? pds.pdsSessionInfo({ memo: new Map(), deadline, deadlineAt: Date.now() + 10_000 }, owner)
          : Promise.resolve(answer),
      setEmailConfirmed: (idHash, value, deadline) =>
        withTransaction(pool, deadline, (tx) => store.setEmailConfirmed(tx, idHash, value)),
    }),
    now: () => Date.now() + afterS * 1000,
    emailRecheckS: RECHECK_S,
  };
}

const visit = (cookie: string, afterS: number) =>
  openApp(
    gate(afterS),
    new Request("https://unset.test/me", { headers: { "x-test-sid": cookie } }),
    AbortSignal.timeout(5000),
    "/me",
  );

/** Two browsers of one account, each with a confirmed email checked just now, over one stored grant. */
async function twoBrowsers() {
  const owner = newDid();
  await tokenSets.set(owner, { authMethod: { method: "private_key_jwt", kid: "A" } });
  const first = await withTransaction(pool, null, (tx) => store.create(tx, owner));
  const second = await withTransaction(pool, null, (tx) => store.create(tx, owner));
  await withTransaction(pool, null, (tx) => store.setEmailConfirmed(tx, { did: owner }, true));
  return { owner, first: first.cookieValue, second: second.cookieValue };
}

function redirected(result: Awaited<ReturnType<typeof visit>>): Response {
  if (!(result instanceof Response)) throw new Error("the gate let the request through");
  return result;
}

test("email_recheck.revoked_grant_signs_out_every_browser", async () => {
  const { owner, first, second } = await twoBrowsers();
  const ended = redirected(await visit(first, RECHECK_S + 1));
  expect(ended.status).toBe(303);
  expect(ended.headers.get("location")).toBe("/login?error=login.session_ended");
  expect(ended.headers.getSetCookie()).toEqual([sessionClearCookie()]);
  expect(await sessionsOf(owner)).toBe(0);
  expect(await hasToken(owner)).toBe(false);
  // The second browser's cache is still fresh, but its session row is gone, so it goes to sign in.
  const next = redirected(await visit(second, 0));
  expect(next.headers.get("location")).toBe("/login?next=%2Fme");
  expect(next.headers.getSetCookie()).toEqual([sessionClearCookie()]);
});

test("email_recheck.bound_is_the_recheck", async () => {
  // Inside the recheck the gate asks the PDS nothing, so a revoke is not seen yet; the first stale request ends it.
  expect(RECHECK_S).toBe(900);
  const { owner, first } = await twoBrowsers();
  expect(await visit(first, RECHECK_S - 1)).toMatchObject({ session: { did: owner } });
  expect(restores).toBe(0);
  expect(await sessionsOf(owner)).toBe(2);
  expect(redirected(await visit(first, RECHECK_S + 1)).headers.get("location")).toBe(
    "/login?error=login.session_ended",
  );
  expect(restores).toBe(1);
  expect(await sessionsOf(owner)).toBe(0);
});

test("email_recheck.transient_changes_no_session", async () => {
  grant = "pds_down";
  const { owner, first } = await twoBrowsers();
  const opened = await visit(first, RECHECK_S + 1);
  expect(opened).toMatchObject({ session: { did: owner }, privacyNotice: false });
  expect(restores).toBe(1);
  expect(await sessionsOf(owner)).toBe(2);
  expect(await hasToken(owner)).toBe(true);
});

test("email_recheck.scope_missing_goes_to_verify_email", async () => {
  answer = { kind: "scope_missing", scope: "account:email" };
  const { owner, first } = await twoBrowsers();
  const response = redirected(await visit(first, RECHECK_S + 1));
  expect(response.headers.get("location")).toBe("/verify-email");
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await sessionsOf(owner)).toBe(2);
  expect(await hasToken(owner)).toBe(true);
});
