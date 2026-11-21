// P1.20k, ported from tests/integration/http/logout.test.ts (P2.08a, P2.08c, P2.08j, P2.03t): signing out on the built
// SvelteKit server, against Postgres as `web` with the real session store, token sets and OAuth client (TE-2). The
// stand-ins are the network a test may not reach (TE-1): PLC and our PDS's authorization server, whose revocation
// endpoint the test watches. One browser signing out keeps the others and the grant; the last browser revokes it, and
// a row past its idle or absolute expiry is no browser; sign out everywhere ends only the caller's sessions; nothing
// writes a sign-in record or a DID into a log line.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import {
  type BrowserKey,
  type ChatUser,
  type DeviceId,
  type LockKey,
  type SessionRef,
  sessionRef,
} from "@unset/domains-messaging";
import { AUDIT_ACTIONS } from "@unset/infrastructure-audit";
import {
  createBrowserListStore,
  createLockPool,
  createOAuthSessionStore,
  createPool,
  createRequestLock,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore, type SessionLimits } from "@unset/infrastructure-session";
import { scopeString } from "@unset/shared-lexicons";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { createSignInLock } from "../../../interfaces/web/src/lib/server/sign-in-lock.ts";
import { asAuditor } from "../setup/pg.setup.ts";
import {
  buildOnce,
  clientAddress,
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
} from "./built-server.ts";
import { readyMember } from "./members.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-sign-out-test",
  max: 4,
  connectTimeoutMs: 5000,
});
// The door's own role, to give a browser a chat entry as the door would (migration 0038).
const doorPool = createPool({
  connection: { host: provided.host, port: provided.port, database, ...provided.roles.chat_auth, ssl: false },
  service: "web-sign-out-door",
  max: 2,
  connectTimeoutMs: 5000,
});
const auditorPool = asAuditor(inject("postgresAuditor"), database);
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const lockPool = createLockPool({
  connection: { ...pg, ssl: false },
  service: "web-sign-out-lock",
  max: 2,
  log: quiet,
});

/** The server's session limits, set below so the expiry edges are known (the defaults are a week and 30 days). */
const LIMITS: SessionLimits = { idleS: 3600, absoluteS: 86_400, touchIntervalS: 300 };
const PDS = `https://${PDS_HOST}`;
const REVOKE = `POST ${PDS}/oauth/revoke`;
const REQUEST_URI = "urn:ietf:params:oauth:request_uri:req-0123456789abcdef";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
/** Accounts the stand-in PLC knows, all on our PDS; each test signs in as its own. */
const ACCOUNTS: Did[] = Array.from({ length: 32 }, (_, i) => {
  const did = parseDid(`did:plc:${"q".repeat(22)}${BASE32[i >> 5]}${BASE32[i & 31]}`);
  if (did === null) throw new Error("test DID did not parse");
  return did;
});
let next = 0;
const newDid = (): Did => ACCOUNTS[next++] as Did;

const plcDocument = (did: string) => ({
  "@context": ["https://www.w3.org/ns/did/v1"],
  id: did,
  verificationMethod: [{ id: `${did}#atproto`, type: "Multikey", controller: did, publicKeyMultibase: "zQ3sh" }],
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
});

/** Our PDS as the OAuth library sees it, granting `sub`; its revocation endpoint answers `revokeStatus`. */
const pdsFixture = (sub: string, revokeStatus = 200): StandInFixture => ({
  http: Object.fromEntries(ACCOUNTS.map((did) => [`https://plc.directory/${did}`, { body: plcDocument(did) }])),
  fetch: {
    [`GET ${PDS}/.well-known/oauth-protected-resource`]: { body: { resource: PDS, authorization_servers: [PDS] } },
    [`GET ${PDS}/.well-known/oauth-authorization-server`]: {
      body: {
        issuer: PDS,
        authorization_endpoint: `${PDS}/oauth/authorize`,
        token_endpoint: `${PDS}/oauth/token`,
        revocation_endpoint: `${PDS}/oauth/revoke`,
        pushed_authorization_request_endpoint: `${PDS}/oauth/par`,
        require_pushed_authorization_requests: true,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["ES256"],
        dpop_signing_alg_values_supported: ["ES256"],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        scopes_supported: ["atproto"],
      },
    },
    [`POST ${PDS}/oauth/par`]: { status: 201, body: { request_uri: REQUEST_URI, expires_in: 299 } },
    [`POST ${PDS}/oauth/token`]: {
      body: {
        access_token: "at",
        refresh_token: "rt",
        token_type: "DPoP",
        sub,
        expires_in: 3600,
        scope: scopeString(),
      },
    },
    [REVOKE]: { status: revokeStatus, body: {} },
  },
});

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  web = await startWeb(
    pg,
    {
      SESSION_IDLE_S: String(LIMITS.idleS),
      SESSION_ABSOLUTE_S: String(LIMITS.absoluteS),
      SESSION_TOUCH_INTERVAL_S: String(LIMITS.touchIntervalS),
    },
    pdsFixture(ACCOUNTS[0] as string),
  );
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await Promise.all([pool.end(), auditorPool.end(), lockPool.pool.end(), doorPool.end()]);
});

const headers = (extra: Record<string, string> = {}) => ({ "x-forwarded-for": clientAddress(), ...extra });
const post = (path: string, body: string, cookie = "") =>
  web.fetch(path, {
    method: "POST",
    body,
    headers: headers({
      origin: ORIGIN,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie === "" ? {} : { cookie }),
    }),
  });
const cookieValue = (response: Response, name: string): string => {
  const line = response.headers.getSetCookie().find((each) => each.startsWith(`${name}=`)) ?? "";
  return line.slice(name.length + 1).split(";")[0] ?? "";
};

/** A whole sign-in for `did` on a new browser, through PAR and the callback; returns its session cookie value. */
async function signIn(did: Did, revokeStatus = 200): Promise<string> {
  web.setStandIns(pdsFixture(did, revokeStatus));
  const started = await post("/login", "intent=chooser&next=%2Fsettings");
  const nonce = cookieValue(started, "__Host-oauth_nonce");
  const { rows } = await pool.query<{ key: string }>(
    "SELECT key FROM app.oauth_state ORDER BY expires_at DESC LIMIT 1",
  );
  const query = new URLSearchParams({ state: rows[0]?.key ?? "", iss: PDS, code: "code-1" });
  const callback = await web.fetch(`/oauth/callback?${query}`, {
    headers: headers({ cookie: `__Host-oauth_nonce=${nonce}` }),
  });
  expect(callback.status).toBe(303);
  const sid = cookieValue(callback, "__Host-sid");
  expect(sid).not.toBe("");
  return sid;
}

const sid = (value: string) => `__Host-sid=${value}`;
/** The session still signs its browser in: /login sends a member on to their page. */
const signedIn = async (value: string): Promise<boolean> =>
  (await web.fetch("/login", { headers: headers({ cookie: sid(value) }) })).status === 303;
const signOut = (value: string, body = "") => post("/logout", body, sid(value));
const signOutEverywhere = (value: string, body = "") => post("/logout/everywhere", body, sid(value));

const hasToken = async (did: Did) =>
  (await pool.query("SELECT 1 FROM app.oauth_session WHERE did = $1", [did])).rows.length === 1;
const sessionsOf = async (did: Did) =>
  (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM app.session WHERE did = $1", [did])).rows[0]?.n;
/** audit.chain's length, read as the auditor role, which the server under test never holds. */
const chainRows = async () =>
  withClient(auditorPool, null, async (client) => {
    const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM audit.chain");
    return rows[0]?.n;
  });

/** What the server did from here on: its revocation calls, and its log events other than access lines. */
function watch() {
  const calls = web.standInCalls().length;
  const lines = web.logs().length;
  return {
    revokes: () =>
      web
        .standInCalls()
        .slice(calls)
        .filter((call) => call === REVOKE).length,
    events: () =>
      web
        .logs()
        .slice(lines)
        .map((line) => line.event)
        .filter((event) => event !== "http.request"),
  };
}
const logsName = (did: Did) => JSON.stringify(web.logs()).includes(did);

beforeEach(() => web.setStandIns(pdsFixture(ACCOUNTS[0] as string)));

describe("one browser of several", () => {
  test("signing_out_one_browser_keeps_the_other_and_the_grant", async () => {
    const owner = newDid();
    const first = await signIn(owner);
    const second = await signIn(owner);
    const seen = watch();
    const response = await signOut(first);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(seen.revokes()).toBe(0);
    expect(await sessionsOf(owner)).toBe(1);
    expect(await hasToken(owner)).toBe(true);
    expect(await signedIn(second)).toBe(true);
    // The grant gone (its token set deleted), the other browser is signed out at its next request.
    await pool.query("DELETE FROM app.oauth_session WHERE did = $1", [owner]);
    expect(await sessionsOf(owner)).toBe(0);
    const gone = await web.fetch("/me", { headers: headers({ cookie: sid(second) }) });
    expect(gone.status).toBe(303);
    expect(gone.headers.get("location")).toBe("/login?next=%2Fme");
    expect(gone.headers.getSetCookie().some((line) => line.startsWith("__Host-sid=;"))).toBe(true);
    expect(logsName(owner)).toBe(false);
  });

  test("a_new_sign_in_on_another_browser_keeps_the_first_signed_in", async () => {
    // P2.03t (ADR 0049): the library replaces the token set at each sign-in (@atproto/oauth-client 0.8.10
    // oauth-client.js `callback`: delete, then store); the sign-in lock drops that delete, so the other browsers stay.
    const owner = newDid();
    const first = await signIn(owner);
    await signIn(owner);
    expect(await sessionsOf(owner)).toBe(2);
    expect(await signedIn(first)).toBe(true);
  });

  test("a_replaced_token_set_keeps_the_sessions_and_a_real_delete_ends_them", async () => {
    // The same, through the lock the server composes (sign-in-lock.ts): a delete followed by a store is an update in
    // place; a delete with no store after it is real and ends every browser, as it must.
    const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }));
    if (keyring === undefined) throw new Error("test keyring did not parse");
    const tokenSets = createOAuthSessionStore({ pool, sealer: createSealer(keyring), log: quiet });
    const lock = createSignInLock({ store: tokenSets, lock: createRequestLock(lockPool) });
    const owner = newDid();
    const other = await signIn(owner);
    await lock.during(async () => {
      await lock.tokenSets.del(owner);
      await lock.tokenSets.set(owner, { authMethod: { method: "private_key_jwt", kid: "B" } });
    });
    expect(await sessionsOf(owner)).toBe(1);
    expect(await signedIn(other)).toBe(true);
    await lock.during(async () => {
      await lock.tokenSets.del(owner);
    });
    expect(await hasToken(owner)).toBe(false);
    expect(await sessionsOf(owner)).toBe(0);
    expect(await signedIn(other)).toBe(false);
  });
});

describe("the last browser", () => {
  test("the_last_browser_revokes_the_grant", async () => {
    const owner = newDid();
    const only = await signIn(owner);
    const seen = watch();
    const response = await signOut(only);
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(seen.revokes()).toBe(1);
    expect(await hasToken(owner)).toBe(false);
    expect(await sessionsOf(owner)).toBe(0);
  });

  test("a_refused_revocation_still_leaves_no_grant_and_logs_no_did", async () => {
    // verify-1020 M1: when the revocation fails, the stored set is still dropped. The library ignores a refusal from
    // the revocation endpoint and deletes the set itself (@atproto/oauth-client 0.9.3 dist/oauth-server-agent.js
    // `revoke`: "Don't care"); oauth.revoke_failed is logged only when the call throws or times out.
    const owner = newDid();
    const only = await signIn(owner, 500);
    const seen = watch();
    expect((await signOut(only)).headers.get("location")).toBe("/signed-out");
    expect(seen.revokes()).toBe(1);
    expect(await hasToken(owner)).toBe(false);
    expect(await sessionsOf(owner)).toBe(0);
    expect(seen.events()).toEqual(["auth.logout_this_browser", "oauth.session_deleted"]);
    expect(logsName(owner)).toBe(false);
  });

  // P2.08c: a row past its idle or absolute expiry signs nobody in, but no sweep may have run yet. Counting it would
  // keep the grant alive after the last real browser signs out. `stale` backdates a row: last seen `idleS` ago, its
  // absolute expiry `absoluteS` after that. INSIDE_S is a few seconds, so a slow runner cannot cross a limit between
  // the insert and the sign-out.
  const INSIDE_S = 5;
  const stale = (owner: Did, ages: { idleS: number; absoluteS: number }) =>
    pool.query(
      "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at) VALUES " +
        "($1, $2, now() - make_interval(secs => $3), now() - make_interval(secs => $3), " +
        "now() - make_interval(secs => $3) + make_interval(secs => $4))",
      [randomBytes(32), owner, ages.idleS, ages.absoluteS],
    );
  /** Signs in once, adds a backdated row, signs the live browser out: whether the grant was revoked. */
  async function revokedBesides(ages: { idleS: number; absoluteS: number }): Promise<boolean> {
    const owner = newDid();
    const only = await signIn(owner);
    await stale(owner, ages);
    const seen = watch();
    expect((await signOut(only)).headers.get("location")).toBe("/signed-out");
    const revoked = seen.revokes() === 1;
    expect(await hasToken(owner)).toBe(!revoked);
    return revoked;
  }

  test("a_row_past_the_idle_limit_is_no_browser", async () => {
    expect(await revokedBesides({ idleS: LIMITS.idleS + 60, absoluteS: LIMITS.absoluteS })).toBe(true);
  });
  test("a_row_past_the_absolute_limit_is_no_browser", async () => {
    expect(await revokedBesides({ idleS: 60, absoluteS: 30 })).toBe(true);
  });
  test("a_row_inside_the_idle_limit_is_a_browser", async () => {
    expect(await revokedBesides({ idleS: LIMITS.idleS - INSIDE_S, absoluteS: LIMITS.absoluteS })).toBe(false);
  });
  test("a_row_inside_the_absolute_limit_is_a_browser", async () => {
    expect(await revokedBesides({ idleS: 60, absoluteS: 60 + INSIDE_S })).toBe(false);
  });
  // The count reads the idle limit, not the touch interval: reading the latter would drop a browser seen a few
  // minutes ago and revoke a grant a live browser still uses (verify-1009 M3).
  test("a_row_seen_past_the_touch_interval_is_a_browser", async () => {
    expect(await revokedBesides({ idleS: LIMITS.touchIntervalS * 2, absoluteS: LIMITS.absoluteS })).toBe(false);
  });
});

describe("the count against the store", () => {
  const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }));
  if (keyring === undefined) throw new Error("test keyring did not parse");
  const tokenSets = createOAuthSessionStore({ pool, sealer: createSealer(keyring), log: quiet });
  const store = createSessionStore({
    withDb: (deadline, fn) => withClient(pool, deadline, fn),
    limits: LIMITS,
    log: quiet,
  });
  const giveTokenSet = (did: Did) => tokenSets.set(did, { authMethod: { method: "private_key_jwt", kid: "A" } });
  const count = (did: Did) => withTransaction(pool, null, (tx) => store.countLive(tx, did));

  test("a_session_needs_a_token_set_and_ends_with_it", async () => {
    // P2.03t (migration 0024, ADR 0049): a session cannot be written before its token set and is deleted with it.
    const owner = newDid();
    await expect(withTransaction(pool, null, (tx) => store.create(tx, owner))).rejects.toMatchObject({ code: "23503" });
    await giveTokenSet(owner);
    await withTransaction(pool, null, (tx) => store.create(tx, owner));
    expect(await count(owner)).toBe(1);
    await tokenSets.del(owner);
    expect(await count(owner)).toBe(0);
    await giveTokenSet(owner);
    expect(await count(owner)).toBe(0);
  });

  // P2.08c, pinned to the store. now() does not move inside one transaction, so the count and the store's own read
  // judge the same instant. Offsets are seconds from now(); a row's absolute expiry is its creation plus the absolute
  // limit, as the store writes it. A neighbour's live session and token set never count for another DID.
  const EDGES = [
    { edge: "1 s inside the idle limit", seenS: -LIMITS.idleS + 1, createdS: -LIMITS.idleS + 1, live: true },
    { edge: "idle limit reached", seenS: -LIMITS.idleS, createdS: -LIMITS.idleS, live: true },
    { edge: "idle limit passed by 1 s", seenS: -LIMITS.idleS - 1, createdS: -LIMITS.idleS - 1, live: false },
    { edge: "1 s inside the absolute limit", seenS: -60, createdS: -LIMITS.absoluteS + 1, live: true },
    { edge: "absolute limit reached", seenS: -60, createdS: -LIMITS.absoluteS, live: true },
    { edge: "absolute limit passed by 1 s", seenS: -60, createdS: -LIMITS.absoluteS - 1, live: false },
    { edge: "created two idle limits ago, seen a minute ago", seenS: -60, createdS: -2 * LIMITS.idleS, live: true },
  ] as const;

  test("the_count_and_the_store_agree_at_every_edge", async () => {
    const neighbour = newDid();
    await giveTokenSet(neighbour);
    await withTransaction(pool, null, (tx) => store.create(tx, neighbour));
    for (const { edge, seenS, createdS, live } of EDGES) {
      const owner = newDid();
      await giveTokenSet(owner);
      const cookie = randomBytes(32);
      const judged = await withTransaction(pool, null, async (tx) => {
        await tx.query(
          "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at) VALUES ($1, $2, " +
            "now() + make_interval(secs => $3), now() + make_interval(secs => $4), " +
            "now() + make_interval(secs => $3) + make_interval(secs => $5))",
          [createHash("sha256").update(cookie).digest(), owner, createdS, seenS, LIMITS.absoluteS],
        );
        const sameInstant = createSessionStore({ withDb: (_deadline, fn) => fn(tx), limits: LIMITS, log: quiet });
        const counted = await sameInstant.countLive(tx, owner);
        const read = await sameInstant.read({ key: {}, cookieValue: cookie.toString("base64url"), deadline: null });
        return { edge, counted, accepted: read.session !== null };
      });
      expect(judged).toEqual({ edge, counted: live ? 1 : 0, accepted: live });
    }
  });
});

describe("sign out everywhere", () => {
  test("it_ends_every_session_of_the_caller_only", async () => {
    // P2.08j, as the web role against the real store and the definer (migration 0014).
    const owner = newDid();
    const stranger = newDid();
    const here = await signIn(owner);
    const elsewhere = await signIn(owner);
    const theirs = await signIn(stranger);
    web.setStandIns(pdsFixture(owner));
    const chainBefore = await chainRows();
    const seen = watch();
    const response = await signOutEverywhere(here, `did=${stranger}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.getSetCookie().some((line) => line.startsWith("__Host-sid=;"))).toBe(true);
    expect(seen.revokes()).toBe(1);
    expect(await sessionsOf(owner)).toBe(0);
    expect(await hasToken(owner)).toBe(false);
    for (const cookie of [here, elsewhere]) expect(await signedIn(cookie)).toBe(false);
    // Another member's session and grant are untouched, whatever the body named.
    expect(await sessionsOf(stranger)).toBe(1);
    expect(await hasToken(stranger)).toBe(true);
    expect(await signedIn(theirs)).toBe(true);
    // No audit row and no identity in the log: plan §6 "no user sign-in records".
    expect(await chainRows()).toBe(chainBefore);
    // The token store's own line for the deleted set (no DID), then the count.
    expect(seen.events()).toEqual(["oauth.session_deleted", "auth.logout_everywhere"]);
    expect(logsName(owner)).toBe(false);
  });

  test("a_refused_revocation_still_ends_every_session", async () => {
    const owner = newDid();
    const here = await signIn(owner, 500);
    await signIn(owner, 500);
    const seen = watch();
    expect((await signOutEverywhere(here)).headers.get("location")).toBe("/signed-out");
    expect(seen.revokes()).toBe(1);
    expect(await sessionsOf(owner)).toBe(0);
    expect(await hasToken(owner)).toBe(false);
  });
});

test("signing_out_writes_no_sign_in_record", async () => {
  // Plan §6 "no user sign-in records": no audit action names a sign-in, sign-out or session (the closed list mirrors
  // migration 0009's seed), and a sign-out writes only a count without the DID. The repeat finds no session, the
  // idempotent path, which writes nothing at all.
  expect(Object.keys(AUDIT_ACTIONS).filter((action) => /^(auth|login|logout|session|oauth)\./.test(action))).toEqual(
    [],
  );
  const owner = newDid();
  const only = await signIn(owner);
  const chainBefore = await chainRows();
  const seen = watch();
  expect((await signOut(only)).headers.get("location")).toBe("/signed-out");
  expect((await signOut(only)).headers.get("location")).toBe("/signed-out");
  expect(await chainRows()).toBe(chainBefore);
  expect(seen.revokes()).toBe(1);
  expect(seen.events()).toEqual(["auth.logout_this_browser", "oauth.session_deleted"]);
  expect(logsName(owner)).toBe(false);
});

describe("chat on the browsers a session signed in (ADR 0083 decision 5)", () => {
  const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }));
  if (keyring === undefined) throw new Error("test keyring did not parse");
  const browsers = createBrowserListStore(doorPool, createSealer(keyring));
  let d = 0;
  /** The door's entry for `owner` on a new browser, signed in by `ref`; its device. */
  async function chatEntry(owner: Did, ref: SessionRef, user = `u${"w".repeat(20)}` as ChatUser): Promise<DeviceId> {
    const device = `WEB${String(d++).padStart(7, "0")}` as DeviceId;
    const entry = {
      id: randomUUID(),
      did: owner,
      user,
      device,
      lockKey: randomBytes(32) as unknown as LockKey,
    };
    expect(await browsers.add(randomBytes(32) as unknown as BrowserKey, entry, ref, AbortSignal.timeout(5000))).toBe(
      "added",
    );
    return device;
  }
  const refsOf = async (owner: Did) =>
    (await pool.query<{ id_hash: Buffer }>("SELECT id_hash FROM app.session WHERE did = $1", [owner])).rows.map((r) =>
      sessionRef(r.id_hash),
    );
  const queuedDevices = async () =>
    (await pool.query<{ device_id: string }>("SELECT device_id FROM app.chat_session_end")).rows.map(
      (r) => r.device_id,
    );

  test("log_out_queues_the_chat_devices_this_session_signed_in", async () => {
    const owner = newDid();
    const first = await signIn(owner);
    const [firstRef] = await refsOf(owner);
    await signIn(owner);
    const secondRef = (await refsOf(owner)).find((ref) => ref !== firstRef) as SessionRef;
    const mine = await chatEntry(owner, firstRef as SessionRef);
    const other = await chatEntry(owner, secondRef);
    expect((await signOut(first)).status).toBe(303);
    const queued = await queuedDevices();
    expect(queued).toContain(mine);
    expect(queued).not.toContain(other);
  });

  test("sign_out_everywhere_queues_every_chat_device_of_the_member", async () => {
    const owner = newDid();
    const here = await signIn(owner);
    await signIn(owner);
    const devices = await Promise.all((await refsOf(owner)).map((ref) => chatEntry(owner, ref)));
    web.setStandIns(pdsFixture(owner));
    expect((await signOutEverywhere(here)).status).toBe(303);
    const queued = await queuedDevices();
    for (const device of devices) expect(queued).toContain(device);
  });

  // Alex, 2026-11-21: no Log out on the chat page; unset.sh's Log out drives it in the browser that signed chat in.
  /** `owner` onboarded, with the chat account the queued job then creates; its chat user. */
  async function readyChat(owner: Did): Promise<ChatUser> {
    await readyMember(pool, owner, true);
    const { rows } = await pool.query<{ chat_user: ChatUser }>(
      "UPDATE app.chat_account SET state = 'ready' WHERE did = $1 RETURNING chat_user",
      [owner],
    );
    if (rows[0] === undefined) throw new Error("no chat account queued");
    return rows[0].chat_user;
  }
  const CHAT_COOKIE = "__Host-chat_sign_out";
  const DOOR = "https://staging.unset.cc";
  /** The payload of the ticket in a /sign-out/return address. */
  const payloadOf = (location: string) => {
    const ticket = new URLSearchParams(new URL(location).hash.slice(1)).get("ticket") ?? "";
    return (JSON.parse(Buffer.from(ticket, "base64url").toString("utf8")) as { payload: Record<string, unknown> })
      .payload;
  };

  test("log_out_with_chat_here_goes_through_the_chat_page: a ticket for the ended session, once", async () => {
    const owner = newDid();
    const cookie = await signIn(owner);
    const [ref] = await refsOf(owner);
    const user = await readyChat(owner);
    await chatEntry(owner, ref as SessionRef, user);
    const response = await signOut(cookie);
    expect(response.status).toBe(303);
    // Chromium applies form-action 'self' to a form's redirects, so the door is reached from a page of ours.
    expect(response.headers.get("location")).toBe("/logout/chat");
    const line = response.headers.getSetCookie().find((each) => each.startsWith(`${CHAT_COOKIE}=`)) ?? "";
    const parts = line.split(";").map((part) => part.trim().toLowerCase());
    for (const part of ["path=/", "secure", "httponly", "samesite=strict", "max-age=60"]) expect(parts).toContain(part);
    expect(parts.some((part) => part.startsWith("domain="))).toBe(false);
    const carried = `${CHAT_COOKIE}=${cookieValue(response, CHAT_COOKIE)}`;
    const page = await web.fetch("/logout/chat", { headers: headers({ cookie: carried }) });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.getSetCookie().some((each) => each.startsWith(`${CHAT_COOKIE}=;`))).toBe(true);
    const html = await page.text();
    const refresh = /<meta http-equiv="refresh" content="0;url=([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&");
    expect(refresh?.startsWith(`${DOOR}/sign-out/return#ticket=`)).toBe(true);
    const payload = payloadOf(refresh ?? "");
    expect([payload.verb, payload.did, payload.user, payload.sid]).toEqual(["session.mint", owner, user, ref]);
    expect(payload.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(logsName(owner)).toBe(false);
    // Spent: the page without its cookie is the signed-out page.
    const again = await web.fetch("/logout/chat", { headers: headers() });
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe("/signed-out");
  });

  test("log_out_without_chat_here_goes_straight_to_signed_out", async () => {
    const owner = newDid();
    const first = await signIn(owner);
    const [firstRef] = await refsOf(owner);
    await signIn(owner);
    const secondRef = (await refsOf(owner)).find((ref) => ref !== firstRef) as SessionRef;
    // The member has chat, but only another browser's session signed it in.
    await chatEntry(owner, secondRef, await readyChat(owner));
    const response = await signOut(first);
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(response.headers.getSetCookie().some((each) => each.startsWith(`${CHAT_COOKIE}=`))).toBe(false);
  });

  test("log_out_gives_the_chat_page_time: the queued end is not due at once", async () => {
    const owner = newDid();
    const cookie = await signIn(owner);
    const [ref] = await refsOf(owner);
    const device = await chatEntry(owner, ref as SessionRef, await readyChat(owner));
    expect((await signOut(cookie)).status).toBe(303);
    expect(await queuedDevices()).toContain(device);
    const due = await pool.query<{ device_id: string }>("SELECT device_id FROM app.claim_chat_session_end(100, 60)");
    expect(due.rows.map((r) => r.device_id)).not.toContain(device);
  });

  test("log_out_done_bounces_same_site: unset.cc's way back reaches /signed-out from a page of ours", async () => {
    // The issuer cookie stays Strict; the door sends the tab here, and this page's own navigation is same-site.
    const owner = newDid();
    const line =
      (await signOut(await signIn(owner))).headers
        .getSetCookie()
        .find((each) => each.startsWith("__Host-signed_out_issuer=")) ?? "";
    expect(line.split(";").map((part) => part.trim().toLowerCase())).toContain("samesite=strict");
    const page = await web.fetch("/logout/done", { headers: headers({ cookie: "__Host-signed_out_issuer=x" }) });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.getSetCookie()).toEqual([]);
    expect(await page.text()).toContain('<meta http-equiv="refresh" content="0;url=/signed-out"');
  });
});
