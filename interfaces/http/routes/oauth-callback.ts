// GET /oauth/callback (P2.06; plan §2 rules 2, 3, 6, 7; §5.3): where a grant becomes a session, only for the browser
// that started the sign-in, only for the account it named, and only with a grant that covers what a session needs.
// The library has already spent its state, checked `iss` and checked the token's `sub` (completeAuthorization). The
// steps below run in the book's order; each refusal goes back to the sign-in form with its code and creates nothing.
//
// A GET that changes state: P1.07 lists this path in GET_MUTATION_EXCEPTIONS, protected by the state ↔ nonce binding,
// not by the CSRF gate. No audit row and no DID in any log line (plan §6 "no user sign-in records"): only the counts
// `auth.login_succeeded` and `auth.login_denied {code}`.
//
// P2.05s: a sign-in is tried silently first (prompt=none). When the server cannot answer without a page, the
// callback sends the same browser straight back to it once, with the page; `auth.login_silent_refused` counts that.
import { timingSafeEqual } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import { type CallbackResult, grantCovers } from "@unset/infrastructure-pds";
import type { ErrorCode } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import { redirect } from "../redirect.ts";
import { sessionCookieValue, sessionSetCookie } from "../session-cookie.ts";
import type { AuthorizationTarget } from "./login.ts";
import {
  appStateOf,
  clearIssuerCookie,
  clearNonceCookie,
  clearSignedOutCookie,
  nonceFromCookies,
  parseAppState,
} from "./sign-in-state.ts";

export type CallbackDeps = {
  /** infrastructure/pds completeAuthorization over the one OAuth client. */
  complete: (query: URLSearchParams) => Promise<CallbackResult>;
  /** P1.16 consume of a `login.nonce`. */
  consumeNonce: (nonce: string, deadline: AbortSignal) => Promise<"ok" | "invalid">;
  /** P2.03 create in its own transaction, deleting the session `replacingCookie` named (fixation). */
  createSession: (
    did: Did,
    replacingCookie: string | null,
    deadline: AbortSignal,
  ) => Promise<{ cookieValue: string; expiresAt: Date }>;
  /** SESSION_ABSOLUTE_S: the cookie lives as long as the session can. */
  sessionMaxAgeS: number;
  /** P2.05s: login.ts `authorizationTarget`, the same authorize and link check POST /login uses. */
  askWithPage: (input: string, options: { appState: string; deadline: AbortSignal }) => Promise<AuthorizationTarget>;
  /** Our PDS's issuer: what the chooser asks again when the form named no account. */
  pdsIssuer: string;
  log: Logger;
};

/** Equal nonces, compared in constant time; both are 43 characters once parsed, so lengths differ only for junk. */
function sameNonce(a: string, b: string): boolean {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
}

export function oauthCallbackRoutes(deps: CallbackDeps): Route[] {
  const deny = (code: ErrorCode, setCookies: readonly string[] = []): Response => {
    deps.log.info("auth.login_denied", { code });
    return redirect(`/login?error=${code}`, setCookies);
  };

  /** The nonce cookie matches the appState's: this is the browser that started the flow. */
  const startedHere = (request: Request, nonce: string): boolean => {
    const cookieNonce = nonceFromCookies(request.headers.get("cookie"));
    return cookieNonce !== null && sameNonce(cookieNonce, nonce);
  };

  /**
   * P2.05s: the silent attempt needs a page. Asked again only for a silent flow, so never twice, and only for the
   * browser that started it. The nonce stays unspent and its cookie stays: the next callback spends it. A direct
   * 303, not /login/continue: that page's Strict cookie is not sent on this cross-site redirect chain, and no form
   * led here, so form-action does not apply.
   */
  async function askWithPage(request: Request, appState: string, deadline: AbortSignal): Promise<Response> {
    const state = parseAppState(appState);
    if (state === null || !state.silent) return deny("login.failed");
    if (!startedHere(request, state.nonce)) return deny("login.state_mismatch");
    deps.log.info("auth.login_silent_refused");
    const again = appStateOf({ ...state, silent: false });
    const sent = await deps.askWithPage(state.expectedDid ?? deps.pdsIssuer, { appState: again, deadline });
    return sent.ok ? redirect(sent.target, []) : deny(sent.code);
  }

  /** The book's steps 3 to 9, after the library has completed (or refused) the authorization. */
  async function finish(request: Request, completed: CallbackResult, deadline: AbortSignal): Promise<Response> {
    if (!completed.ok) {
      if (completed.reason === "interaction_required") return askWithPage(request, completed.appState, deadline);
      return deny(`login.${completed.reason}`);
    }
    const state = parseAppState(completed.appState);
    if (state === null) return deny("login.failed");

    // The nonce, before anything is spent: a mismatch may be another tab's live flow, so its cookie stays.
    if (!startedHere(request, state.nonce)) return deny("login.state_mismatch");
    const consumed = await deps.consumeNonce(state.nonce, deadline).catch((error: unknown) => {
      deps.log.warn("oauth.callback_failed", { kind: error instanceof Error ? error.constructor.name : "unknown" });
      return "failed" as const;
    });
    if (consumed === "failed") return deny("login.failed");
    if (consumed === "invalid") return deny("login.expired");
    const spent = [clearNonceCookie()];

    // A refusal from here leaves the new token set in place: it serves that account's other browsers (P2.04 step 7).
    if (state.expectedDid !== null && completed.did !== state.expectedDid) return deny("login.account_mismatch", spent);
    if (!grantCovers(completed.scope).ok) {
      await completed.revoke();
      return deny("login.scope_insufficient", spent);
    }

    const replacing = sessionCookieValue(request.headers.get("cookie"));
    let created: { cookieValue: string };
    try {
      created = await deps.createSession(completed.did, replacing, deadline);
    } catch (error) {
      deps.log.warn("oauth.callback_failed", { kind: error instanceof Error ? error.constructor.name : "unknown" });
      return deny("login.failed", spent);
    }
    deps.log.info("auth.login_succeeded");
    // A sign-in ends the signed-out state, so the previous account's carried issuer goes with it.
    const signedOut = [clearSignedOutCookie(), clearIssuerCookie()];
    const cookies = [...spent, ...signedOut, sessionSetCookie(created.cookieValue, deps.sessionMaxAgeS)];
    return redirect(state.next ?? "/did", cookies);
  }

  return [
    defineRoute({
      method: "GET",
      path: "/oauth/callback",
      group: "app",
      rateLimit: "login",
      mutates: true,
      session: "none",
      handler: async ({ request, deadline }) => {
        const completed = await deps.complete(new URL(request.url).searchParams);
        return finish(request, completed, deadline);
      },
    }),
  ];
}
