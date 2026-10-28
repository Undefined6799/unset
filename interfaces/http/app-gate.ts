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
import type { ReactNode } from "react";
import { redirect } from "./redirect.ts";
import { sessionClearCookie } from "./session-cookie.ts";
import type { PageSpec } from "./web/page.ts";

export type AppGate = {
  readSession: (request: Request, deadline: AbortSignal) => Promise<SessionRead>;
  loadAccount: (did: Did, deadline: AbortSignal) => Promise<OnboardingAccount | null>;
  versions: OnboardingVersions;
  emailCache: (session: Session, deadline: AbortSignal) => Promise<EmailCache>;
  refreshEmail: (session: Session, deadline: AbortSignal) => Promise<EmailRefresh>;
  now: () => number;
  emailRecheckS: number;
  /**
   * The PDS-unavailable page (verify-email's `unavailable` state). A transient recheck past the cache cap returns it
   * and keeps the session (P2.11d).
   */
  unavailablePage: (request: Request) => Response;
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

/**
 * The PDS-unavailable page, the same screen verify-email renders for a transient read. Callers pass that screen's
 * `unavailable` state; this only fixes the page around it.
 */
export function pdsUnavailablePage(request: Request, body: ReactNode, page: (spec: PageSpec) => Response): Response {
  return page({
    group: "app",
    request,
    title: "Confirm your email",
    body,
    shell: {},
  });
}

/**
 * requireSession, then requireOnboarded, then requireVerified. `next` is a path this route owns, never the request.
 * A cached confirmation is served on a transient recheck for at most 4 × `emailRecheckS` (P2.11d). Past that, the
 * unavailable page is shown and the session stays. A dead grant still signs out.
 */
export async function openApp(
  gate: AppGate,
  request: Request,
  deadline: AbortSignal,
  next: string,
): Promise<Response | OpenedApp> {
  const { session, clearCookie } = await gate.readSession(request, deadline);
  if (session === null)
    return redirect(`/login?${new URLSearchParams({ next })}`, clearCookie ? [sessionClearCookie()] : []);
  const account = await gate.loadAccount(session.did, deadline);
  const decision = requireOnboarded(account, gate.versions);
  const away = redirectFor(decision, next);
  if (away !== null) return redirect(away);
  const now = gate.now();
  const cache = await gate.emailCache(session, deadline);
  const email = emailGate(cache, now, gate.emailRecheckS);
  const opened = (): OpenedApp => ({
    session,
    privacyNotice: decision.outcome === "pass" && decision.privacyNotice,
  });
  switch (email) {
    case "verify":
      return redirect("/verify-email");
    case "pass":
      return opened();
    case "refresh": {
      const answer = await gate.refreshEmail(session, deadline);
      // The cap is the age when the answer arrives. The PDS call can take its 10s timeout (pds-call.ts
      // PDS_CALL_TIMEOUT_MS), so the time from before the await would still open the page after the bound.
      const after = verifiedAfterRefresh(answer, cache, gate.now(), gate.emailRecheckS);
      switch (after) {
        case "pass":
          return opened();
        case "verify":
          return redirect("/verify-email");
        case "ended":
          // P2.11a: the grant was revoked at the PDS, and pdsCall has already ended every session of the DID. This
          // browser signs in again on the page respondToPdsFailure uses for auth_dead (pds-call.ts:232-234).
          return redirect(withErrorParam("/login", "login.session_ended"), [sessionClearCookie()]);
        case "unavailable":
          return gate.unavailablePage(request);
        default: {
          const unexpected: never = after;
          return unexpected;
        }
      }
    }
    default: {
      const unexpected: never = email;
      return unexpected;
    }
  }
}
