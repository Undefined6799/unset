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
import { type SessionGate, safeReturnPath } from "@unset/shared-http";
import type { ReactNode } from "react";
import { redirect } from "./redirect.ts";
import { sessionClearCookie } from "./session-cookie.ts";
import type { PageSpec } from "./web/page.ts";

export type AppGate = {
  readSession: (request: Request, deadline: AbortSignal) => Promise<SessionRead>;
  loadAccount: (did: Did, deadline: AbortSignal) => Promise<OnboardingAccount | null>;
  versions: OnboardingVersions;
  /** `deadlineAt` is the route handler's own (shared/http routes.ts): the PDS read retries only while it fits. */
  refreshEmail: (session: Session, deadline: AbortSignal, deadlineAt: number) => Promise<EmailRefresh>;
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
  deadlineAt: number,
): Promise<Response | OpenedApp> {
  const { session, clearCookie } = await gate.readSession(request, deadline);
  if (session === null)
    return redirect(`/login?${new URLSearchParams({ next })}`, clearCookie ? [sessionClearCookie()] : []);
  const account = await gate.loadAccount(session.did, deadline);
  const decision = requireOnboarded(account, gate.versions);
  const away = redirectFor(decision, next);
  if (away !== null) return redirect(away);
  const now = gate.now();
  // The session read already carries the cached answer and when it was written (P2.03m): no second query (P2.12f).
  // A session without a check time reads as never checked, so the gate asks the PDS.
  const cache: EmailCache = { confirmed: session.emailConfirmed, checkedAt: session.emailCheckedAt ?? null };
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
      const answer = await gate.refreshEmail(session, deadline, deadlineAt);
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

/** Where sign-in returns when the refused route is not itself a page to come back to. */
const RETURN_TO: Readonly<Record<string, string>> = { "/me": "/did", "/profile": "/did" };

/**
 * The app gate as the server's session gate (ADR 0045): the kit runs it before every `session: "required"` handler.
 * The return path comes from the route's template, never the request: a GET page without parameters (or its HEAD)
 * returns to itself, anything else needs an entry above. A route with neither throws, which the kit answers as a
 * denial.
 */
export function appSessionGate(
  open: (request: Request, deadline: AbortSignal, next: string, deadlineAt: number) => Promise<Response | OpenedApp>,
): SessionGate {
  return async ({ request, route, deadline, deadlineAt }) => {
    // The kit answers HEAD from the GET route (shared/http/server.ts), so a HEAD returns where its GET would.
    const page = (request.method === "GET" || request.method === "HEAD") && !/[:*]/.test(route);
    const next = RETURN_TO[route] ?? (page ? route : null);
    if (next === null) throw new Error(`${route}: no return path after sign-in`);
    const opened = await open(request, deadline, next, deadlineAt);
    return opened instanceof Response ? opened : { did: opened.session.did, session: opened };
  };
}
