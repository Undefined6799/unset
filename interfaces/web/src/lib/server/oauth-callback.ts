// GET /oauth/callback (P2.06; plan §2 rules 2, 3, 6, 7; §5.3), ported from interfaces/http/routes/oauth-callback.ts
// (P1.20e): where a grant becomes a session, only for the browser that started the sign-in, only for the account it
// named, and only with a grant that covers what a session needs. The library has already spent its state, checked
// `iss` and checked the token's `sub` (completeAuthorization). The steps run in the book's order; each refusal goes
// back to the sign-in form with its code and creates nothing.
//
// A GET that changes state, protected by the state ↔ nonce binding, not by the CSRF gate. No audit row and no DID in
// any log line: only the counts `auth.login_succeeded` and `auth.login_denied`. The one sign-in record is the member's
// own history row, the time only (ADR 0082, amending plan §6 "no user sign-in records").
// P2.06 step 11: once the session exists, one best-effort read of the member's email state (`emailAnswerAtSignIn`).
// P2.05s: a sign-in is tried silently first (prompt=none). When the server cannot answer without a page, the callback
// sends the same browser straight back to it once, with the page; `auth.login_silent_refused` counts that.
import { timingSafeEqual } from "node:crypto";
import { type Cookies, redirect } from "@sveltejs/kit";
import type { Did } from "@unset/domains-identity";
import { type CallbackResult, completeAuthorization, grantCovers } from "@unset/infrastructure-pds";
import { withClient, withTransaction } from "@unset/infrastructure-postgres";
import type { ErrorCode } from "@unset/shared-errors";
import type { SafePath } from "@unset/shared-http";
import { services } from "./compose.ts";
import { sendPrivacyNoticeIfChanged, sendSignIn } from "./notification-sources.ts";
import { config } from "./runtime.ts";
import { putSessionCookie, sessionCookieValue } from "./session.ts";
import { authorizationTarget } from "./sign-in.ts";
import { appStateOf, dropCookie, issuerOrigin, nonceFromCookies, parseAppState } from "./sign-in-state.ts";

/** Equal nonces, compared in constant time; both are 43 characters once parsed, so lengths differ only for junk. */
function sameNonce(a: string, b: string): boolean {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
}

const className = (error: unknown): string => (error instanceof Error ? error.constructor.name : "unknown");

/** Back to the sign-in form with `code`, counted. Throws SvelteKit's 303 (cookies already set go with it). */
function deny(code: ErrorCode, next: SafePath | null = null): never {
  services().log.info("auth.login_denied", { code });
  redirect(303, `/login?error=${code}${next === null ? "" : `&next=${encodeURIComponent(next)}`}`);
}

/** The nonce cookie matches the appState's: this is the browser that started the flow. */
const startedHere = (request: Request, nonce: string): boolean => {
  const cookieNonce = nonceFromCookies(request.headers.get("cookie"));
  return cookieNonce !== null && sameNonce(cookieNonce, nonce);
};

/**
 * P2.05s: the silent attempt needs a page. Asked again only for a silent flow, so never twice, and only for the
 * browser that started it. The nonce stays unspent and its cookie stays: the next callback spends it. A direct 303,
 * not /login/continue: that page's Strict cookie is not sent on this cross-site redirect chain.
 */
async function askWithPage(request: Request, appState: string, deadline: AbortSignal): Promise<never> {
  const state = parseAppState(appState);
  if (state === null || !state.silent) deny("login.failed");
  if (!startedHere(request, state.nonce)) deny("login.state_mismatch");
  services().log.info("auth.login_silent_refused");
  const again = appStateOf({ ...state, silent: false });
  const sent = await authorizationTarget(state.expectedDid ?? services().pdsIssuer, { appState: again, deadline });
  if (!sent.ok) deny(sent.code);
  // Kit 3.2.0 refuses an external redirect unless allowed by origin (src/exports/url.js validate_redirect_location):
  // only our PDS's, since only its accounts sign in (P1.36v).
  redirect(303, sent.target, { external: [services().pdsIssuer] });
}

/** Step 11's budget: the book's 5 s, within what the request's own deadline leaves. */
const EMAIL_READ_MS = 5000;
/** Kept for the redirect after the read, so a slow PDS never turns the sign-in into the deadline's 503. */
const EMAIL_READ_RESERVE_MS = 500;

/** Resolves with null once `signal` aborts: the race below stops waiting on work that does not watch the signal. */
const abandoned = (signal: AbortSignal): Promise<null> =>
  new Promise((done) => {
    if (signal.aborted) done(null);
    else signal.addEventListener("abort", () => done(null), { once: true });
  });

/**
 * P2.06 step 11: ask the PDS once whether the email is confirmed and cache an answer on the new session, so the P2.11
 * gate (unchanged) passes a confirmed member straight on. Best effort: a PDS that is slow, failing or gives no answer
 * leaves the cache null, which the gate reads as "not confirmed" and sends to /verify-email; that page always reads the
 * PDS afresh and caches its answer, so a confirmation made later is picked up there. Never throws, so it never stops
 * the sign-in. Logs `auth.email_read_failed` with the error class or "timeout" only. Runs inside the sign-in scope,
 * so the library's lock calls for this account reuse the lock the scope already holds (sign-in-lock.ts).
 */
async function emailAnswerAtSignIn(event: CallbackEvent, did: Did, idHash: Buffer): Promise<void> {
  const { pds, setEmailConfirmed, log } = services();
  // Whole milliseconds: AbortSignal.timeout throws a RangeError on a fraction.
  const budget = Math.floor(Math.min(EMAIL_READ_MS, event.deadlineAt - performance.now() - EMAIL_READ_RESERVE_MS));
  if (budget <= 0) return;
  const deadline = AbortSignal.any([event.deadline, AbortSignal.timeout(budget)]);
  const deadlineAt = performance.now() + budget;
  const readAndCache = async (): Promise<"done"> => {
    const info = await pds.pdsSessionInfo({ memo: new Map(), deadline, deadlineAt }, did);
    if (info.kind === "ok" && info.value.emailConfirmed !== undefined) {
      await setEmailConfirmed(idHash, info.value.emailConfirmed, deadline);
    }
    return "done";
  };
  // Neither the token restore inside pdsSessionInfo nor a running query watches the signal, so the read and the write
  // race the budget together: the sign-in never waits past it. Work left behind ends on its own; a failure is logged.
  const failed = (error: unknown): "done" => {
    log.warn("auth.email_read_failed", { kind: className(error) });
    return "done";
  };
  const work = readAndCache();
  const outcome = await Promise.race([work.catch(failed), abandoned(deadline)]);
  if (outcome === null) log.warn("auth.email_read_failed", { kind: "timeout" });
}

/** The book's steps 3 to 9 and 11, after the library has completed (or refused) the authorization. Always throws a 303. */
async function finish(event: CallbackEvent, completed: CallbackResult): Promise<never> {
  const { request, cookies, deadline } = event;
  if (!completed.ok) {
    if (completed.reason === "interaction_required") return askWithPage(request, completed.appState, deadline);
    if (completed.reason === "consent_denied") {
      // Only the starting browser may reuse the sealed state's path, revalidated by parseAppState; never the query.
      const state = parseAppState(completed.appState);
      deny("login.consent_denied", state !== null && startedHere(request, state.nonce) ? state.next : null);
    }
    deny(`login.${completed.reason}`);
  }
  const state = parseAppState(completed.appState);
  if (state === null) deny("login.failed");

  // The nonce, before anything is spent: a mismatch may be another tab's live flow, so its cookie stays.
  if (!startedHere(request, state.nonce)) deny("login.state_mismatch");
  const { pool, nonces, sessions, log } = services();
  const consumed = await withClient(pool, deadline, (db) => nonces.consume(db, "login.nonce", state.nonce)).catch(
    (error: unknown) => {
      log.warn("oauth.callback_failed", { kind: className(error) });
      return "failed" as const;
    },
  );
  if (consumed === "failed") deny("login.failed");
  if (consumed === "invalid") deny("login.expired");
  dropCookie(cookies, "nonce");

  // A refusal from here leaves the new token set in place: it serves that account's other browsers (P2.04 step 7).
  if (state.expectedDid !== null && completed.did !== state.expectedDid) deny("login.account_mismatch");
  if (!grantCovers(completed.scope).ok) {
    await completed.revoke();
    deny("login.scope_insufficient");
  }

  const replacing = sessionCookieValue(request.headers.get("cookie"));
  const origin = issuerOrigin(completed.issuer);
  let created: { cookieValue: string; idHash: Buffer };
  try {
    // The sign-in's notification and its history entry are written in the same transaction, so their time is the
    // session's own (P2.27, P2.27c).
    created = await withTransaction(pool, deadline, async (tx) => {
      const session = await sessions.create(
        tx,
        completed.did,
        replacing === null ? { issuerOrigin: origin } : { replacingCookie: replacing, issuerOrigin: origin },
      );
      await sendSignIn(tx, completed.did);
      await services().signIns.recordIn(tx, completed.did);
      return session;
    });
  } catch (error) {
    log.warn("oauth.callback_failed", { kind: className(error) });
    deny("login.failed");
  }
  log.info("auth.login_succeeded");
  // Best effort: the banner tells the member as well, so a failure here never costs them the sign-in.
  await sendPrivacyNoticeIfChanged(completed.did, deadline).catch((error: unknown) => {
    log.warn("notifications.send_failed", { kind: className(error) });
  });
  await emailAnswerAtSignIn(event, completed.did, created.idHash);
  // A sign-in ends the signed-out state, so the previous account's carried issuer goes with it.
  dropCookie(cookies, "signedOut");
  dropCookie(cookies, "issuer");
  putSessionCookie(cookies, created.cookieValue, config.SESSION_ABSOLUTE_S);
  redirect(303, state.next ?? "/me");
}

export type CallbackEvent = {
  readonly request: Request;
  readonly cookies: Cookies;
  readonly deadline: AbortSignal;
  /** The request deadline on the monotonic clock (`performance.now`), as hooks.server.ts sets it. */
  readonly deadlineAt: number;
};

/**
 * The whole callback under the sign-in scope (P1.36y): from the library storing the token set until the session row
 * exists, the account's lock is held, so the last browser's sign-out cannot revoke this grant midway.
 */
export function completeSignIn(event: CallbackEvent): Promise<never> {
  const { oauth, pdsIssuer, log } = services();
  return oauth.signInScope(async () => {
    const query = new URL(event.request.url).searchParams;
    const completed = await completeAuthorization(oauth.client, query, log, pdsIssuer);
    return finish(event, completed);
  });
}
