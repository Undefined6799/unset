// GET /oauth/callback (P2.06; plan §2 rules 2, 3, 6, 7; §5.3), ported from interfaces/http/routes/oauth-callback.ts
// (P1.20e): where a grant becomes a session, only for the browser that started the sign-in, only for the account it
// named, and only with a grant that covers what a session needs. The library has already spent its state, checked
// `iss` and checked the token's `sub` (completeAuthorization). The steps run in the book's order; each refusal goes
// back to the sign-in form with its code and creates nothing.
//
// A GET that changes state, protected by the state ↔ nonce binding, not by the CSRF gate. No audit row and no DID in
// any log line (plan §6 "no user sign-in records"): only the counts `auth.login_succeeded` and `auth.login_denied`.
// P2.05s: a sign-in is tried silently first (prompt=none). When the server cannot answer without a page, the callback
// sends the same browser straight back to it once, with the page; `auth.login_silent_refused` counts that.
import { timingSafeEqual } from "node:crypto";
import { type Cookies, redirect } from "@sveltejs/kit";
import { type CallbackResult, completeAuthorization, grantCovers } from "@unset/infrastructure-pds";
import { withClient, withTransaction } from "@unset/infrastructure-postgres";
import type { ErrorCode } from "@unset/shared-errors";
import { services } from "./compose.ts";
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
function deny(code: ErrorCode): never {
  services().log.info("auth.login_denied", { code });
  redirect(303, `/login?error=${code}`);
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

/** The book's steps 3 to 9, after the library has completed (or refused) the authorization. Always throws a 303. */
async function finish(event: CallbackEvent, completed: CallbackResult): Promise<never> {
  const { request, cookies, deadline } = event;
  if (!completed.ok) {
    if (completed.reason === "interaction_required") return askWithPage(request, completed.appState, deadline);
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
  let created: { cookieValue: string };
  try {
    created = await withTransaction(pool, deadline, (tx) =>
      sessions.create(
        tx,
        completed.did,
        replacing === null ? { issuerOrigin: origin } : { replacingCookie: replacing, issuerOrigin: origin },
      ),
    );
  } catch (error) {
    log.warn("oauth.callback_failed", { kind: className(error) });
    deny("login.failed");
  }
  log.info("auth.login_succeeded");
  // A sign-in ends the signed-out state, so the previous account's carried issuer goes with it.
  dropCookie(cookies, "signedOut");
  dropCookie(cookies, "issuer");
  putSessionCookie(cookies, created.cookieValue, config.SESSION_ABSOLUTE_S);
  redirect(303, state.next ?? "/me");
}

export type CallbackEvent = { readonly request: Request; readonly cookies: Cookies; readonly deadline: AbortSignal };

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
