// The gate on an app page (P2.12): session, then onboarding, then a confirmed email. Legal, logout, welcome and
// signed-out pages do not use it. The decision is the identity domain's; this file only turns it into a redirect.

import type { Did } from "@unset/domains-identity";
import {
  type EmailCache,
  type EmailRefresh,
  emailGate,
  type OnboardingAccount,
  type OnboardingDecision,
  type OnboardingVersions,
  requireOnboarded,
  verifiedAfterRefresh,
} from "@unset/domains-identity";
import type { Session, SessionRead } from "@unset/infrastructure-session";
import { withErrorParam } from "@unset/shared-errors";
import { safeReturnPath } from "@unset/shared-http";
import { sessionClearCookie } from "./session-cookie.ts";

export type AppGate = {
  readSession: (request: Request, deadline: AbortSignal) => Promise<SessionRead>;
  loadAccount: (did: Did, deadline: AbortSignal) => Promise<OnboardingAccount | null>;
  versions: OnboardingVersions;
  emailCache: (session: Session, deadline: AbortSignal) => Promise<EmailCache>;
  refreshEmail: (session: Session, deadline: AbortSignal) => Promise<EmailRefresh>;
  now: () => number;
  emailRecheckS: number;
};

export type OpenedApp = { readonly session: Session; readonly privacyNotice: boolean };

/** Where a decision sends the browser, or null when the page may render. `next` is the route that was refused. */
export function redirectFor(decision: OnboardingDecision, next: string): string | null {
  switch (decision.outcome) {
    case "pass":
      return null;
    case "welcome":
      return "/welcome";
    case "terms": {
      const back = safeReturnPath(next);
      return back === null ? "/welcome/terms" : `/welcome/terms?${new URLSearchParams({ next: back })}`;
    }
    case "blocked":
      return "/welcome/blocked";
    default: {
      const unexpected: never = decision;
      return unexpected;
    }
  }
}

function redirect(location: string, clearCookie: boolean): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (clearCookie) headers.append("set-cookie", sessionClearCookie());
  return new Response(null, { status: 303, headers });
}

/**
 * requireSession, then requireOnboarded, then requireVerified. `next` is a path this route owns, never the request.
 */
export async function openApp(
  gate: AppGate,
  request: Request,
  deadline: AbortSignal,
  next: string,
): Promise<Response | OpenedApp> {
  const { session, clearCookie } = await gate.readSession(request, deadline);
  if (session === null) return redirect(`/login?${new URLSearchParams({ next })}`, clearCookie);
  const account = await gate.loadAccount(session.did, deadline);
  const decision = requireOnboarded(account, gate.versions);
  const away = redirectFor(decision, next);
  if (away !== null) return redirect(away, false);
  const cache = await gate.emailCache(session, deadline);
  const email = emailGate(cache, gate.now(), gate.emailRecheckS);
  if (email === "verify") return redirect("/verify-email", false);
  if (email === "refresh") {
    const answer = verifiedAfterRefresh(await gate.refreshEmail(session, deadline));
    if (answer === "verify") return redirect("/verify-email", false);
    // P2.11a: the grant was revoked at the PDS, and pdsCall has already ended every session of the DID. This browser
    // signs in again on the page respondToPdsFailure uses for auth_dead (pds-call.ts:232-234).
    if (answer === "ended") return redirect(withErrorParam("/login", "login.session_ended"), true);
  }
  return { session, privacyNotice: decision.outcome === "pass" && decision.privacyNotice };
}
