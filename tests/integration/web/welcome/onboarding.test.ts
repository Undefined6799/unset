// P1.20f: the app gate, onboarding and the email check on the built web server, the outcomes interfaces/http's
// app-gate, welcome and verify-email tests check today. Postgres as `web` (TE-2): accounts, the audit row and the
// session store are real. The PDS and its authorization server are the network the server may not reach in a test
// (TE-1): stand-in-server.ts answers them, and getSession's answer is changed per test. The OAuth client that
// restores the member's grant and signs each PDS call is real.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, PRIVACY_VERSION, parseDid, TERMS_VERSION } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createAccountRepository,
  createOAuthSessionStore,
  createPool,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, afterEach, beforeAll, describe, expect, inject, test } from "vitest";
import {
  buildOnce,
  clientAddress,
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
} from "../built-server.ts";
import { DATA, dataAnswer, inlineScripts, nodeData, startupData } from "../data-address.ts";
import { readyMember } from "../members.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-onboarding-test",
  max: 3,
  connectTimeoutMs: 5000,
});
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only writes through its own transactions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const accounts = createAccountRepository(pool, {
  recordUnderageBlock: async () => {
    throw new Error("only the server blocks");
  },
});
// The server unseals the grants this file stores, so both use one keyring, handed to the server by file.
const KEYRING = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
const keyring = parseKeyring(KEYRING);
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });

const PDS = `https://${PDS_HOST}`;
const GET_SESSION = `GET ${PDS}/xrpc/com.atproto.server.getSession`;

let made = 0;
/** A new DID for each test, so no test sees another's account or sessions. */
const didOf = (n: number): Did => {
  const tail = [...String(n).padStart(4, "0")].map((digit) => "abcdefghij"[Number(digit)]).join("");
  const did = parseDid(`did:plc:${"w".repeat(20)}${tail}`);
  if (did === null) throw new Error("test DID did not parse");
  return did;
};
const nextDid = (): Did => didOf(++made);
/** Every DID this file can make, placed on our PDS by the stand-in PLC. */
const PLC = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => {
    const did = didOf(i + 1);
    const document = {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: did,
      verificationMethod: [{ id: `${did}#atproto`, type: "Multikey", controller: did, publicKeyMultibase: "zQ3sh" }],
      service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
    };
    return [`https://plc.directory/${did}`, { body: document }];
  }),
);

/** Our PDS's authorization server, and getSession answering `emailConfirmed` (or `status` with no body). */
function pdsFixture(
  getSession: { status?: number; emailConfirmed?: boolean } = { emailConfirmed: true },
): StandInFixture {
  const body =
    getSession.status !== undefined
      ? { error: "Unavailable" }
      : {
          did: didOf(1),
          handle: `member.${PDS_HOST}`,
          email: "m@example.com",
          emailConfirmed: getSession.emailConfirmed,
        };
  return {
    http: PLC,
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
      [`POST ${PDS}/oauth/revoke`]: { body: {} },
      [GET_SESSION]: { status: getSession.status ?? 200, body },
    },
  };
}

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  const dir = mkdtempSync(join(tmpdir(), "web-onboarding-"));
  const keyringFile = join(dir, "seal_keyring");
  writeFileSync(keyringFile, KEYRING);
  web = await startWeb(pg, { SEAL_KEYRING_FILE: keyringFile, SUPPORT_EMAIL: "support@unset.test" }, pdsFixture());
}, 120_000);
afterEach(() => web.setStandIns(pdsFixture()));
afterAll(async () => {
  await web?.stop();
  await pool.end();
});

/**
 * A signed-in browser for a new member with no onboarding yet (or a new session for `did`); returns the DID and the
 * cookie header. An `expired` grant has no refresh token left, so restoring it is a dead grant (pds-errors.ts
 * restoreOutcome: TokenRefreshError).
 */
async function signedIn(options: { did?: Did; expired?: boolean } = {}): Promise<{ did: Did; cookie: string }> {
  const did = options.did ?? nextDid();
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(did, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: PDS,
      sub: did as SavedSession["tokenSet"]["sub"],
      aud: PDS,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
      ...(options.expired ? { expires_at: new Date(Date.now() - 60_000).toISOString() } : {}),
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did, { issuerOrigin: PDS }));
  return { did, cookie: `__Host-sid=${created.cookieValue}` };
}

const HTML = "text/html";
const get = (path: string, cookie = "") =>
  web.fetch(path, { headers: { accept: HTML, "x-forwarded-for": clientAddress(), ...(cookie ? { cookie } : {}) } });
const post = (path: string, body: string, cookie: string) =>
  web.fetch(path, {
    method: "POST",
    body,
    headers: {
      origin: ORIGIN,
      accept: HTML,
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": clientAddress(),
      cookie,
    },
  });
const location = (response: Response) => response.headers.get("location");
const sessionCount = async (did: Did): Promise<number> =>
  (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM app.session WHERE did = $1", [did])).rows[0]?.n ??
  -1;

/** An onboarded member whose cached confirmation is `ageS` seconds old (EMAIL_RECHECK_S is 900 by default). */
async function staleConfirmation(did: Did, ageS: number): Promise<void> {
  await readyMember(pool, did, true);
  await pool.query("UPDATE app.session SET email_checked_at = now() - make_interval(secs => $2) WHERE did = $1", [
    did,
    ageS,
  ]);
}

/** A date `years` years ago today, as the age form's three fields. */
function bornYearsAgo(years: number): string {
  const now = new Date();
  return new URLSearchParams({
    day: String(now.getUTCDate()),
    month: String(now.getUTCMonth() + 1),
    year: String(now.getUTCFullYear() - years),
  }).toString();
}

describe("the app gate", () => {
  test("a_new_member_on_an_app_page_is_sent_to_onboarding", async () => {
    const { cookie } = await signedIn();
    expect(location(await get("/test-routes/members", cookie))).toBe("/welcome");
    expect(location(await get("/welcome", cookie))).toBe("/welcome/age");
  });

  test("a_visitor_on_an_onboarding_page_signs_in_first", async () => {
    expect(location(await get("/welcome/age"))).toBe("/login?next=%2Fwelcome%2Fage");
    expect(location(await get("/verify-email"))).toBe("/login?next=%2Fverify-email");
  });

  test("an_onboarded_member_with_a_confirmed_email_reaches_the_page", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did);
    const response = await get("/test-routes/members", cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("privacy notice");
  });

  test("a_changed_privacy_notice_shows_the_banner_once_through_locals", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did);
    await accounts.acceptTerms(did, TERMS_VERSION, "2000-01-01", AbortSignal.timeout(5000));
    const body = await (await get("/test-routes/members", cookie)).text();
    expect(PRIVACY_VERSION).not.toBe("2000-01-01");
    expect(body).toContain("privacy notice");
  });

  // P2.12b: the banner shows on every app page until the member dismisses it, and only a POST records that.
  const seenOf = async (did: Did) =>
    (
      await pool.query<{ privacy_version: string | null; privacy_notice_seen_version: string | null }>(
        "SELECT privacy_version, privacy_notice_seen_version FROM app.account WHERE did = $1",
        [did],
      )
    ).rows[0];
  async function withOldNotice() {
    const member = await signedIn();
    await readyMember(pool, member.did);
    await accounts.acceptTerms(member.did, TERMS_VERSION, "2000-01-01", AbortSignal.timeout(5000));
    return member;
  }
  const dismiss = (version = PRIVACY_VERSION) =>
    new URLSearchParams({ version, return: "/test-routes/members" }).toString();
  const BANNER = 'action="/privacy-notice/seen"';

  test("terms.privacy_bump_notice_until_dismissed", async () => {
    const { did, cookie } = await withOldNotice();
    for (let i = 0; i < 3; i++) expect(await (await get("/test-routes/members", cookie)).text()).toContain(BANNER);
    // A GET never records it.
    expect(await seenOf(did)).toEqual({ privacy_version: "2000-01-01", privacy_notice_seen_version: null });
  });

  test("terms.privacy_notice_dismiss", async () => {
    const { did, cookie } = await withOldNotice();
    const response = await post("/privacy-notice/seen", dismiss(), cookie);
    expect(response.status).toBe(303);
    expect(location(response)).toBe("/test-routes/members");
    expect(await (await get("/test-routes/members", cookie)).text()).not.toContain(BANNER);
    // Seen, not accepted: the accepted version is unchanged.
    expect(await seenOf(did)).toEqual({ privacy_version: "2000-01-01", privacy_notice_seen_version: PRIVACY_VERSION });
  });

  test("a_dismiss_of_an_older_notice_records_nothing", async () => {
    const { did, cookie } = await withOldNotice();
    expect(location(await post("/privacy-notice/seen", dismiss("2000-06-01"), cookie))).toBe("/test-routes/members");
    expect(await seenOf(did)).toEqual({ privacy_version: "2000-01-01", privacy_notice_seen_version: null });
    expect(await (await get("/test-routes/members", cookie)).text()).toContain(BANNER);
  });

  test("a_cross_site_or_signed_out_dismiss_writes_nothing", async () => {
    const { did, cookie } = await withOldNotice();
    const foreign = await web.fetch("/privacy-notice/seen", {
      method: "POST",
      body: dismiss(),
      headers: {
        origin: "https://evil.example",
        accept: HTML,
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": clientAddress(),
        cookie,
      },
    });
    expect(foreign.status).toBe(403);
    const noOrigin = await web.fetch("/privacy-notice/seen", {
      method: "POST",
      body: dismiss(),
      headers: {
        accept: HTML,
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": clientAddress(),
        cookie,
      },
    });
    expect(noOrigin.status).toBe(403);
    expect(location(await post("/privacy-notice/seen", dismiss(), ""))).toMatch(/^\/login/);
    expect(await seenOf(did)).toEqual({ privacy_version: "2000-01-01", privacy_notice_seen_version: null });
  });

  test("an_unconfirmed_email_goes_to_verify_email", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did, false);
    expect(location(await get("/test-routes/members", cookie))).toBe("/verify-email");
  });

  test("a_stale_confirmation_is_asked_of_the_pds_and_cached_again", async () => {
    const { did, cookie } = await signedIn();
    await staleConfirmation(did, 1000);
    const before = web.standInCalls().length;
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    expect(web.standInCalls().slice(before)).toContain(GET_SESSION);
    // Cached on the session: the next page asks nobody.
    const again = web.standInCalls().length;
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    expect(web.standInCalls().slice(again)).not.toContain(GET_SESSION);
  });

  test("a_pds_that_does_not_answer_shows_the_unavailable_state_and_keeps_the_session", async () => {
    web.setStandIns(pdsFixture({ status: 503 }));
    const { did, cookie } = await signedIn();
    // Within 4 × EMAIL_RECHECK_S the cached answer still serves; past it the member is told and kept.
    await staleConfirmation(did, 1000);
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    await staleConfirmation(did, 4000);
    expect(location(await get("/test-routes/members", cookie))).toBe("/verify-email");
    // The member is on hold since the first failure: the page says so without waiting on the PDS again.
    const before = web.standInCalls().length;
    const page = await get("/verify-email", cookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("is not answering; your session is kept.");
    expect(web.standInCalls().slice(before)).not.toContain(GET_SESSION);
    expect(await sessionCount(did)).toBe(1);
  });

  test("an_ended_grant_signs_the_member_out_with_the_cookie_cleared", async () => {
    // Within the cache cap and past it alike: a dead grant is never served from the cache.
    for (const ageS of [1000, 4000]) {
      const { did, cookie } = await signedIn({ expired: true });
      await staleConfirmation(did, ageS);
      const response = await get("/test-routes/members", cookie);
      expect(location(response), String(ageS)).toBe("/login?error=login.session_ended");
      expect(
        response.headers.getSetCookie().some((line) => line.startsWith("__Host-sid=;")),
        String(ageS),
      ).toBe(true);
      expect(await sessionCount(did), String(ageS)).toBe(0);
    }
  });

  test("a_fresh_check_passes_without_asking_the_pds", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did);
    const before = web.standInCalls().length;
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    expect(web.standInCalls().slice(before)).not.toContain(GET_SESSION);
  });

  test("a_session_never_checked_asks_the_pds", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did);
    await pool.query("UPDATE app.session SET email_checked_at = NULL WHERE did = $1", [did]);
    const before = web.standInCalls().length;
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    expect(web.standInCalls().slice(before)).toContain(GET_SESSION);
  });

  test("a_confirmation_past_the_cap_that_the_pds_gives_again_restores_the_page", async () => {
    const { did, cookie } = await signedIn();
    await staleConfirmation(did, 4000);
    const checkedAt = async () =>
      (await pool.query<{ at: Date }>("SELECT email_checked_at AS at FROM app.session WHERE did = $1", [did])).rows[0]
        ?.at;
    const prior = await checkedAt();
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    // The answer was cached again: that is what lets the next view pass without asking.
    expect((await checkedAt())?.getTime()).toBeGreaterThan(prior?.getTime() ?? Number.POSITIVE_INFINITY);
  });

  // Ported from tests/integration/http/email-recheck.test.ts (P2.11a, P2.11d) at P1.20k.
  test("a_dead_grant_ends_every_browser_of_the_member", async () => {
    const first = await signedIn({ expired: true });
    const second = await signedIn({ did: first.did, expired: true });
    await staleConfirmation(first.did, 1000);
    // The second browser's cache is fresh again, so it asks the PDS nothing; its session still ends with the grant.
    const secondHash = createHash("sha256")
      .update(Buffer.from(second.cookie.slice("__Host-sid=".length), "base64url"))
      .digest();
    expect(
      (await pool.query("UPDATE app.session SET email_checked_at = now() WHERE id_hash = $1", [secondHash])).rowCount,
    ).toBe(1);
    const ended = await get("/test-routes/members", first.cookie);
    expect(location(ended)).toBe("/login?error=login.session_ended");
    expect(await sessionCount(first.did)).toBe(0);
    expect((await pool.query("SELECT 1 FROM app.oauth_session WHERE did = $1", [first.did])).rows).toEqual([]);
    const next = await get("/test-routes/members", second.cookie);
    expect(location(next)).toBe("/login?next=%2Ftest-routes%2Fmembers");
    expect(next.headers.getSetCookie().some((line) => line.startsWith("__Host-sid=;"))).toBe(true);
  });

  test("inside_the_recheck_the_pds_is_not_asked_so_a_dead_grant_waits_for_it", async () => {
    // The bound P2.11a pins: a grant revoked at the PDS is seen at most EMAIL_RECHECK_S (900 s) later.
    const { did, cookie } = await signedIn({ expired: true });
    await staleConfirmation(did, 899);
    const before = web.standInCalls().length;
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    expect(web.standInCalls().slice(before)).not.toContain(GET_SESSION);
    expect(await sessionCount(did)).toBe(1);
    await staleConfirmation(did, 901);
    expect(location(await get("/test-routes/members", cookie))).toBe("/login?error=login.session_ended");
  });

  test("a_rate_limit_or_a_401_with_the_grant_stored_past_the_cap_keeps_the_session", async () => {
    // pds-call.ts: a 429, and a 401 while our token set remains, are transient, so the member is told and kept.
    for (const status of [429, 401]) {
      web.setStandIns(pdsFixture({ status }));
      const { did, cookie } = await signedIn();
      await staleConfirmation(did, 4000);
      expect(location(await get("/test-routes/members", cookie)), String(status)).toBe("/verify-email");
      expect(await (await get("/verify-email", cookie)).text(), String(status)).toContain(
        "is not answering; your session is kept.",
      );
      expect(await sessionCount(did), String(status)).toBe(1);
      expect((await pool.query("SELECT 1 FROM app.oauth_session WHERE did = $1", [did])).rows.length).toBe(1);
    }
  });

  test("the_hold_after_a_pds_that_does_not_answer_is_per_member", async () => {
    web.setStandIns(pdsFixture({ status: 503 }));
    const first = await signedIn();
    const second = await signedIn();
    await staleConfirmation(first.did, 1000);
    await staleConfirmation(second.did, 1000);
    const asked = () => web.standInCalls().filter((call) => call === GET_SESSION).length;
    const start = asked();
    expect((await get("/test-routes/members", first.cookie)).status).toBe(200);
    const afterFirst = asked();
    expect(afterFirst).toBeGreaterThan(start);
    // The same member is on hold: the cached pass is served without asking again.
    expect((await get("/test-routes/members", first.cookie)).status).toBe(200);
    expect(asked()).toBe(afterFirst);
    // Another member is asked.
    expect((await get("/test-routes/members", second.cookie)).status).toBe(200);
    expect(asked()).toBeGreaterThan(afterFirst);
  });

  test("a_blocked_member_who_signs_in_again_sees_only_the_blocked_page", async () => {
    const { did, cookie } = await signedIn();
    expect(location(await post("/welcome/age", `${bornYearsAgo(12)}&confirmed=yes`, cookie))).toBe("/welcome/blocked");
    const again = await signedIn({ did });
    await withTransaction(pool, null, (tx) => sessions.setEmailConfirmed(tx, { did }, true));
    for (const path of ["/me", `/${did}`, "/settings/profile", "/test-routes/members", "/welcome", "/welcome/age"]) {
      const response = await get(path, again.cookie);
      expect(response.status, path).toBe(303);
      expect(location(response), path).toBe("/welcome/blocked");
    }
  });

  test("a_cross_site_post_to_an_onboarding_action_is_refused", async () => {
    const { did, cookie } = await signedIn();
    const response = await web.fetch("/welcome/age", {
      method: "POST",
      body: `${bornYearsAgo(30)}&confirmed=yes`,
      headers: {
        origin: "https://evil.example",
        accept: HTML,
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": clientAddress(),
        cookie,
      },
    });
    expect(response.status).toBe(403);
    expect((await accounts.get(did, AbortSignal.timeout(5000)))?.onboarding ?? "age").toBe("age");
  });
});

describe("the age step", () => {
  test("a_date_that_does_not_parse_goes_back_with_its_code", async () => {
    const { cookie } = await signedIn();
    const response = await post("/welcome/age", "day=40&month=1&year=2000", cookie);
    expect(location(response)).toBe("/welcome/age?error=welcome.date_invalid");
  });

  test("a_valid_date_is_shown_back_before_it_counts", async () => {
    const { did, cookie } = await signedIn();
    const response = await post("/welcome/age", bornYearsAgo(30), cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Is this date right?");
    // Nothing is stored until it comes back confirmed.
    expect(location(await get("/welcome", cookie))).toBe("/welcome/age");
    expect((await accounts.get(did, AbortSignal.timeout(5000)))?.onboarding ?? "age").toBe("age");
  });

  test("a_confirmed_adult_goes_on_to_the_terms", async () => {
    const { cookie } = await signedIn();
    const response = await post("/welcome/age", `${bornYearsAgo(30)}&confirmed=yes`, cookie);
    expect(location(response)).toBe("/welcome/terms");
    expect(location(await get("/welcome/age", cookie))).toBe("/welcome/terms");
  });

  test("the_sixteenth_birthday_counts_and_two_days_short_does_not", async () => {
    // The zone rule (a birthday that has arrived anywhere on Earth counts) is domains/identity age.test.ts's.
    const today = await signedIn();
    expect(location(await post("/welcome/age", `${bornYearsAgo(16)}&confirmed=yes`, today.cookie))).toBe(
      "/welcome/terms",
    );
    const short = await signedIn();
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 2);
    const birth = new URLSearchParams({
      day: String(date.getUTCDate()),
      month: String(date.getUTCMonth() + 1),
      year: String(date.getUTCFullYear() - 16),
      confirmed: "yes",
    }).toString();
    expect(location(await post("/welcome/age", birth, short.cookie))).toBe("/welcome/blocked");
  });

  test("a_confirmed_under_age_answer_blocks_the_account_and_ends_every_session", async () => {
    const { did, cookie } = await signedIn();
    const before = web.standInCalls().length;
    const response = await post("/welcome/age", `${bornYearsAgo(12)}&confirmed=yes`, cookie);
    expect(location(response)).toBe("/welcome/blocked");
    expect(response.headers.getSetCookie().some((line) => line.startsWith("__Host-sid=;"))).toBe(true);
    expect(await sessionCount(did)).toBe(0);
    expect(web.standInCalls().slice(before)).toContain(`POST ${PDS}/oauth/revoke`);
    const { rows } = await pool.query("SELECT 1 FROM app.oauth_session WHERE did = $1", [did]);
    expect(rows).toEqual([]);
    // The page names no date and no threshold, and offers the appeal.
    const blocked = await (await get("/welcome/blocked")).text();
    expect(blocked).toContain("Ask for a review");
    expect(blocked).toContain("mailto:support@unset.test?subject=Appeal");
    expect(JSON.stringify(web.logs())).not.toContain(did);
  });
});

describe("the terms step", () => {
  async function atTerms() {
    const member = await signedIn();
    await accounts.confirmAdult(member.did, AbortSignal.timeout(5000));
    return member;
  }
  const accept = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
      accept: "yes",
      country: "yes",
      ...extra,
    }).toString();

  test("the_page_names_the_versions_it_shows", async () => {
    const { cookie } = await atTerms();
    const body = await (await get("/welcome/terms", cookie)).text();
    expect(body).toContain(`value="${TERMS_VERSION}"`);
    expect(body).toContain(`value="${PRIVACY_VERSION}"`);
  });

  test("an_acceptance_of_other_versions_is_shown_the_page_again", async () => {
    const { cookie } = await atTerms();
    expect(location(await post("/welcome/terms", accept({ terms_version: "1999-01-01" }), cookie))).toBe(
      "/welcome/terms",
    );
  });

  test("each_box_is_required", async () => {
    const { cookie } = await atTerms();
    expect(location(await post("/welcome/terms", accept({ accept: "no" }), cookie))).toBe(
      "/welcome/terms?error=welcome.terms_required",
    );
    expect(location(await post("/welcome/terms", accept({ country: "no" }), cookie))).toBe(
      "/welcome/terms?error=welcome.country_required",
    );
  });

  test("accepting_goes_to_the_chat_step_and_continuing_to_verify_email", async () => {
    const { cookie } = await atTerms();
    expect(location(await post("/welcome/terms", accept(), cookie))).toBe("/welcome/chat");
    expect(location(await post("/welcome/chat", "", cookie))).toBe("/verify-email");
    expect(location(await get("/welcome", cookie))).toBe("/verify-email");
  });
});

describe("leaving and finishing onboarding", () => {
  test("a_privacy_only_change_shows_the_notice_and_asks_for_nothing", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did);
    await accounts.acceptTerms(did, TERMS_VERSION, "2000-01-01", AbortSignal.timeout(5000));
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
    expect(location(await get("/welcome/terms", cookie))).toBe("/me");
  });

  test("the_chat_step_with_a_confirmed_email_goes_to_the_profile", async () => {
    const { did, cookie } = await signedIn();
    await accounts.confirmAdult(did, AbortSignal.timeout(5000));
    await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, AbortSignal.timeout(5000));
    await withTransaction(pool, null, (tx) => sessions.setEmailConfirmed(tx, { did }, true));
    expect(location(await post("/welcome/chat", "", cookie))).toBe("/me");
  });

  test("a_finished_member_on_any_step_returns_to_the_profile", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did);
    for (const path of ["/welcome", "/welcome/age", "/welcome/terms", "/welcome/chat"]) {
      const response = await get(path, cookie);
      expect(response.status, path).toBe(303);
      expect(location(response), path).toBe("/me");
    }
  });

  test("every_held_step_offers_sign_out_and_no_sign_in", async () => {
    const atAge = await signedIn();
    const atTerms = await signedIn();
    await accounts.confirmAdult(atTerms.did, AbortSignal.timeout(5000));
    const atChat = await signedIn();
    await accounts.confirmAdult(atChat.did, AbortSignal.timeout(5000));
    await accounts.acceptTerms(atChat.did, TERMS_VERSION, PRIVACY_VERSION, AbortSignal.timeout(5000));
    const atVerify = await signedIn();
    await readyMember(pool, atVerify.did, false);
    const pages: [string, Response][] = [
      ["age", await get("/welcome/age", atAge.cookie)],
      ["age confirm", await post("/welcome/age", bornYearsAgo(30), atAge.cookie)],
      ["terms", await get("/welcome/terms", atTerms.cookie)],
      ["chat", await get("/welcome/chat", atChat.cookie)],
      ["verify email", await get("/verify-email", atVerify.cookie)],
    ];
    for (const [name, response] of pages) {
      expect(response.status, name).toBe(200);
      const html = await response.text();
      const main = html.slice(html.indexOf('<main id="main"'), html.indexOf("</main>"));
      expect(main.match(/<form method="POST" action="\/logout"/g), name).toHaveLength(1);
      expect(html, name).not.toContain('action="/login"');
      expect(html, name).not.toContain('href="/login');
    }
    // The blocked page has no session left, so it offers no sign-out.
    expect(await (await get("/welcome/blocked")).text()).not.toContain('action="/logout"');
  });
});

describe("verify email", () => {
  test("the_query_never_picks_the_state", async () => {
    web.setStandIns(pdsFixture({ emailConfirmed: false }));
    const { did, cookie } = await signedIn();
    await readyMember(pool, did, false);
    const body = await (await get("/verify-email?state=confirmed&confirmed=true", cookie)).text();
    expect(body).not.toContain("Your email is confirmed.");
    expect(body).toContain(`href="${PDS}/account"`);
  });

  test("no_answer_on_the_email_asks_for_consent_and_a_get_sends_nothing", async () => {
    web.setStandIns(pdsFixture({}));
    const { did, cookie } = await signedIn();
    await readyMember(pool, did, false);
    const before = web.standInCalls().length;
    const body = await (await get("/verify-email", cookie)).text();
    expect(body).toContain('action="?/reconsent"');
    expect(
      web
        .standInCalls()
        .slice(before)
        .filter((call) => call.startsWith("POST ")),
    ).toEqual([]);
  });

  test("an_ended_grant_on_the_page_signs_the_member_out", async () => {
    const { did, cookie } = await signedIn({ expired: true });
    await readyMember(pool, did, false);
    const response = await get("/verify-email", cookie);
    expect(location(response)).toBe("/login?error=login.session_ended");
    expect(response.headers.getSetCookie().some((line) => line.startsWith("__Host-sid=;"))).toBe(true);
  });

  test("a_confirmed_email_is_read_fresh_and_cached", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did, false);
    const page = await get("/verify-email", cookie);
    const text = await page.text();
    expect(text).toContain("Your email is confirmed.");
    expect((await get("/test-routes/members", cookie)).status).toBe(200);
  });

  test("an_unconfirmed_email_links_the_account_page_in_a_new_tab", async () => {
    web.setStandIns(pdsFixture({ emailConfirmed: false }));
    const { did, cookie } = await signedIn();
    await readyMember(pool, did, false);
    const body = await (await get("/verify-email", cookie)).text();
    expect(body).toContain(`href="${PDS}/account"`);
    expect(body).toContain('rel="noopener noreferrer"');
    // The core shell (P1.20k): the member's own account menu and the footer, never Sign in.
    expect(body).toContain('id="account-menu"');
    expect(body).toContain(`href="/${did}"`);
    expect(body).toContain("<footer");
    expect(body).not.toMatch(/href="\/login/);
  });

  // P1.20k: an error page reached mid-onboarding keeps the member signed in but offers none of the app's menus, which
  // would only send them back to their step.
  test("an_error_page_mid_onboarding_shows_no_app_navigation", async () => {
    const { cookie } = await signedIn();
    const response = await get("/nowhere-at-all", cookie);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    for (const menu of ["core-menu", "create-menu", "messages-menu", "notifications-menu", "account-menu"]) {
      expect(body, menu).not.toContain(`id="${menu}"`);
    }
    expect(body).not.toMatch(/href="\/login/);
  });

  test("a_member_not_onboarded_goes_to_their_step_first", async () => {
    const { cookie } = await signedIn();
    expect(location(await get("/verify-email", cookie))).toBe("/welcome");
  });

  test("reconsent_starts_a_sign_in_for_the_same_account", async () => {
    const { did, cookie } = await signedIn();
    await readyMember(pool, did, false);
    web.setStandIns({
      ...pdsFixture(),
      fetch: {
        ...pdsFixture().fetch,
        [`POST ${PDS}/oauth/par`]: {
          status: 201,
          body: { request_uri: "urn:ietf:params:oauth:request_uri:req-0123456789abcdef", expires_in: 299 },
        },
      },
    });
    const response = await post("/verify-email?/reconsent", "", cookie);
    expect(location(response)).toBe("/login/continue");
    const cookies = response.headers.getSetCookie().map((line) => line.split("=")[0]);
    expect(cookies).toContain("__Host-oauth_nonce");
    expect(cookies).toContain("__Host-login_target");
  });
});

// Book P1.22l (ADR 0116): the under-age notice runs SvelteKit's client under the app's script policy, as every page a
// person reads does. It reads nothing of the request but the session, so apart from the reference the appeal link
// makes anew for each visit (welcome.ts `appeal`), its start-up script is the same whatever a link to it says.
describe("the blocked page with the client", () => {
  const withoutReference = (script: string): string => script.replace(/Appeal\+[0-9a-f-]{36}/, "Appeal+");

  test("the_blocked_page_runs_only_our_client_and_its_data_is_what_it_draws", async () => {
    const response = await get("/welcome/blocked");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`script-src ${ORIGIN}/_app/ 'sha256-`);
    expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const html = await response.text();
    const drawn = {
      shell: { kind: "site", noindex: true },
      appeal: expect.stringMatching(/^mailto:support@unset\.test\?/),
    };
    expect(startupData(html, 1)).toEqual(drawn);
    expect(html).toContain("mailto:support@unset.test?subject=Appeal");
    expect(nodeData(await dataAnswer(await get(`/welcome/blocked${DATA}`)), 1)).toEqual(drawn);
    for (const query of [
      "error=%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E",
      "next=javascript:alert(1)",
      "x=%E2%80%A8",
    ]) {
      const asked = await (await get(`/welcome/blocked?${query}`)).text();
      expect(inlineScripts(asked).map(withoutReference), query).toEqual(inlineScripts(html).map(withoutReference));
    }
  });
});
