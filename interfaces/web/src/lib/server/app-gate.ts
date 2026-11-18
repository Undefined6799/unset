// The app gate (P2.11, P2.12), ported from interfaces/http/app-gate.ts (P1.20f; the Hono copy goes at P1.20k): after
// the session, onboarding, then a confirmed email. hooks.server.ts runs it for every request that needs a member
// (`session: "required"`, and a member's request to a `session: "writes"` route); the welcome and verify-email pages
// (`session: "onboarding"`) skip it, because they are where it sends people. The decisions are the identity domain's;
// this file only turns them into SvelteKit redirects, which keep the cookie changes made before them.
import { type Cookies, redirect } from "@sveltejs/kit";
import {
  type EmailCache,
  emailGate,
  type OnboardingDecision,
  requireOnboarded,
  verifiedAfterRefresh,
} from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { safeReturnPath } from "@unset/shared-http";
import { services } from "./compose.ts";
import { config } from "./runtime.ts";
import { dropSessionCookie } from "./session.ts";

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

export type AppGateEvent = {
  readonly cookies: Cookies;
  readonly deadline: AbortSignal;
  readonly deadlineAt: number;
};

/**
 * Onboarding, then the email. Returns whether the one-time privacy banner shows; otherwise throws the redirect. A
 * cached confirmation is served on a transient recheck for at most 4 × EMAIL_RECHECK_S (P2.11d); past that the member
 * goes to /verify-email, which shows the PDS-unavailable state while the hold lasts, and the session stays. A dead
 * grant signs this browser out. `next` is a path this route owns, never the request's.
 */
export async function openApp(
  event: AppGateEvent,
  session: Session,
  next: string,
): Promise<{ privacyNotice: boolean }> {
  const { accounts, versions, email } = services();
  const decision = requireOnboarded(await accounts.get(session.did, event.deadline), versions);
  const away = redirectFor(decision, next);
  if (away !== null) redirect(303, away);
  const opened = { privacyNotice: decision.outcome === "pass" && decision.privacyNotice };
  // The session read already carries the cached answer and when it was written (P2.03m): no second query (P2.12f).
  const cache: EmailCache = { confirmed: session.emailConfirmed, checkedAt: session.emailCheckedAt ?? null };
  const gate = emailGate(cache, Date.now(), config.EMAIL_RECHECK_S);
  if (gate === "pass") return opened;
  if (gate === "verify") redirect(303, "/verify-email");
  const answer = await email.refresh(session, event.deadline, event.deadlineAt);
  // The cap is the age when the answer arrives: the PDS call can take its own 10 s (pds-call.ts PDS_CALL_TIMEOUT_MS).
  const after = verifiedAfterRefresh(answer, cache, Date.now(), config.EMAIL_RECHECK_S);
  switch (after) {
    case "pass":
      return opened;
    case "verify":
    case "unavailable":
      redirect(303, "/verify-email");
      break;
    case "ended":
      // P2.11a: the grant was revoked at the PDS and pdsCall has already ended every session of the DID.
      dropSessionCookie(event.cookies);
      redirect(303, "/login?error=login.session_ended");
      break;
    default: {
      const unexpected: never = after;
      return unexpected;
    }
  }
  return opened;
}
