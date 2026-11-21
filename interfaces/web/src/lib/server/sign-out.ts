// Signing out (P2.08, P2.08a, P2.08b, P2.08j; plan §5.3 "Logout"), ported from interfaces/http/routes/logout.ts and
// logout-sessions.ts (P1.20e). POST only, behind SvelteKit's Origin check, so neither a link nor another site can sign
// a member out. This browser's session ends and the browser is marked signed out, so the next sign-in asks for the
// password again. Other browsers keep their sessions and the shared token set; the last browser revokes the grant
// (review F13). Sign out everywhere revokes the grant and ends every session of the DID. The signed-out page links the
// issuer recorded at sign-in, carried in a short-lived cookie because the last browser's revoke deletes the record.
// Chat follows: the devices a signed-out session signed in on unset.cc are queued to end (ADR 0083 decision 5).
// No DID in any log line.
import { type Cookies, error, redirect } from "@sveltejs/kit";
import type { Did } from "@unset/domains-identity";
import { withClient, withTransaction } from "@unset/infrastructure-postgres";
import type { Session } from "@unset/infrastructure-session";
import { services } from "./compose.ts";
import { withRevokeTimeout } from "./revoke-timeout.ts";
import { dropSessionCookie } from "./session.ts";
import { dropCookie, encodeIssuer, issuerOrigin, putCookie } from "./sign-in-state.ts";

/** The issuer read's own deadline (P2.08h): well below PG_CONNECT_TIMEOUT_MS's 2000, so a hung store cannot hold us. */
export const ISSUER_READ_MS = 250;
/**
 * How often sign-out everywhere tries to end the sessions, and the pause between (P2.08j). Once the revoke has deleted
 * the token set, only this request still knows whose sessions to end; rows left behind would be valid again at the
 * member's next sign-in, so one failed statement must not be the end of it.
 */
const END_ALL_ATTEMPTS = 3;
const END_ALL_PAUSE_MS = 100;

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const className = (cause: unknown): string => (cause instanceof Error && cause.name !== "" ? cause.name : "Error");
/** A retryable 503 with the catalog's code (shared/errors catalog.ts `logout.failed`); the cookie stays for the retry. */
const failed = (): never => error(503, { message: "logout.failed" });

/** Revoke the grant. On any failure the stored set is deleted here, so no grant remains on our side. */
async function revokeOrDrop(did: Did, deadline: AbortSignal): Promise<void> {
  const { oauth, log } = services();
  try {
    // @atproto/oauth-client 0.8.9 OAuthClient.revoke: calls the revocation endpoint, then deletes the stored set.
    await withRevokeTimeout(oauth.client.revoke(did), deadline);
  } catch (cause: unknown) {
    log.warn("oauth.revoke_failed", { kind: className(cause) });
    await oauth
      .dropTokenSet(did, deadline)
      .catch((drop: unknown) => log.warn("oauth.revoke_failed", { kind: className(drop) }));
  }
}

/**
 * The last browser's revoke, under the account's sign-in lock (P1.36y) and counted again there, so it cannot take a
 * grant a concurrent sign-in just stored. If the lock or the count fails, the revoke still runs (F13).
 */
async function endGrantIfLast(did: Did, deadline: AbortSignal): Promise<void> {
  const { oauth, pool, sessions, log } = services();
  try {
    await oauth.lockDid(did, async () => {
      const remaining = await withClient(pool, deadline, (db) => sessions.countLive(db, did));
      if (remaining === 0) await revokeOrDrop(did, deadline);
    });
  } catch (cause: unknown) {
    log.warn("oauth.revoke_failed", { kind: className(cause) });
    await revokeOrDrop(did, deadline);
  }
}

/** Ends every session of the DID, trying again after a failure; the last failure is logged and is a retryable 503. */
async function endEverySession(session: Session, deadline: AbortSignal): Promise<void> {
  const { pool, sessions, chat, log } = services();
  let last: unknown;
  for (let attempt = 1; attempt <= END_ALL_ATTEMPTS && !deadline.aborted; attempt++) {
    if (attempt > 1) await pause(END_ALL_PAUSE_MS);
    try {
      // P2.08j: the definer (migration 0014) ends every session of the DID and deletes its token set; every chat
      // device the member signed in is queued to end with it (ADR 0083 decision 5, migration 0045).
      await withTransaction(pool, deadline, async (tx) => {
        await chat.endFor.queueForDid(tx, session.did);
        await sessions.destroyAllForDid(tx, session.did, "user_signout_all");
      });
      return;
    } catch (cause: unknown) {
      last = cause;
    }
  }
  // The grant is gone and session rows may remain: an operator must be able to see that it happened. No DID.
  log.warn("auth.logout_everywhere_incomplete", { kind: className(last) });
  failed();
}

/**
 * The recorded issuer's origin, read before anything is destroyed, under its own short deadline. A timeout or any
 * error drops the link (the page then links ours) and sign-out continues.
 */
async function recordedIssuer(session: Session): Promise<string | null> {
  const stored = session.issuerOrigin ?? null;
  if (stored !== null) return issuerOrigin(stored) === stored ? stored : null;
  try {
    const issuer = await services().issuerOf(session.did, AbortSignal.timeout(ISSUER_READ_MS));
    return issuer === null ? null : issuerOrigin(issuer);
  } catch (cause: unknown) {
    services().log.warn("auth.logout_issuer_unknown", { kind: className(cause) });
    return null;
  }
}

/** The 303 to the signed-out page, carrying `issuer` (an origin) for its account link, or clearing a stale one. */
function finish(cookies: Cookies, issuer: string | null): never {
  dropSessionCookie(cookies);
  // A sign-in started before this one ends here too: its authorization was made without prompt=login.
  dropCookie(cookies, "nonce");
  dropCookie(cookies, "target");
  putCookie(cookies, "signedOut", "1");
  if (issuer === null) dropCookie(cookies, "issuer");
  else putCookie(cookies, "issuer", encodeIssuer(issuer));
  redirect(303, "/signed-out");
}

/** POST /logout: this browser's session; the grant too when it was the last browser. */
export async function signOut(session: Session | undefined, cookies: Cookies, deadline: AbortSignal): Promise<never> {
  if (session === undefined) finish(cookies, null);
  const issuer = await recordedIssuer(session);
  const { pool, sessions, chat, log } = services();
  // A failed delete is a retryable 503 (book P2.08 step 3), and the cookie stays so the retry finds it. The chat
  // devices this session signed in are queued to end in the same commit (ADR 0083 decision 5, migration 0045).
  const remaining = await withTransaction(pool, deadline, async (tx) => {
    await chat.endFor.queueForSession(tx, session.idHash);
    await sessions.destroy(tx, session.idHash);
    return sessions.countLive(tx, session.did);
  }).catch(failed);
  log.info("auth.logout_this_browser");
  // Last browser: revoke outside the transaction. The count saw this delete.
  if (remaining === 0) await endGrantIfLast(session.did, deadline);
  finish(cookies, issuer);
}

/**
 * POST /logout/everywhere (P2.08j): revoke while the token set is still there, then end every session, both under the
 * account's sign-in lock so a sign-in cannot store a new grant between them. Nothing is read from the body, so no
 * field can name another member. If the lock cannot be had, both still run.
 */
export async function signOutEverywhere(
  session: Session | undefined,
  cookies: Cookies,
  deadline: AbortSignal,
): Promise<never> {
  if (session === undefined) finish(cookies, null);
  const issuer = await recordedIssuer(session);
  const { oauth, log } = services();
  let entered = false;
  const work = async (): Promise<void> => {
    entered = true;
    await revokeOrDrop(session.did, deadline);
    await endEverySession(session, deadline);
  };
  try {
    await oauth.lockDid(session.did, work);
  } catch (cause: unknown) {
    if (entered) throw cause;
    log.warn("oauth.revoke_failed", { kind: className(cause) });
    await work();
  }
  log.info("auth.logout_everywhere");
  finish(cookies, issuer);
}
