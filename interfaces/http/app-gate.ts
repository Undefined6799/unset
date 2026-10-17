// The gate on an app page (P2.12): session, then onboarding, then a confirmed email. Legal, logout, welcome and
// signed-out pages do not use it. The decision is the identity domain's; this file only turns it into a redirect.

import type { Did } from "@unset/domains-identity";
import {
  type EmailCache,
  emailGate,
  type OnboardingAccount,
  type OnboardingDecision,
  type OnboardingVersions,
  requireOnboarded,
  verifiedAfterRefresh,
} from "@unset/domains-identity";
import type { Session, SessionRead } from "@unset/infrastructure-session";
import { sessionClearCookie } from "./session-cookie.ts";

export type AppGate = {
  readSession: (request: Request, deadline: AbortSignal) => Promise<SessionRead>;
  loadAccount: (did: Did, deadline: AbortSignal) => Promise<OnboardingAccount | null>;
  versions: OnboardingVersions;
  emailCache: (session: Session, deadline: AbortSignal) => Promise<EmailCache>;
  refreshEmail: (session: Session, deadline: AbortSignal) => Promise<"transient" | "confirmed" | "unconfirmed">;
  now: () => number;
  emailRecheckS: number;
};

export type OpenedApp = { readonly session: Session; readonly privacyNotice: boolean };

/** Where a decision sends the browser, or null when the page may render. */
export function redirectFor(decision: OnboardingDecision): "/welcome" | "/welcome/terms" | "/welcome/blocked" | null {
  switch (decision.outcome) {
    case "pass":
      return null;
    case "welcome":
      return "/welcome";
    case "terms":
      return "/welcome/terms";
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
  const away = redirectFor(decision);
  if (away !== null) return redirect(away, false);
  const cache = await gate.emailCache(session, deadline);
  const email = emailGate(cache, gate.now(), gate.emailRecheckS);
  if (email === "verify") return redirect("/verify-email", false);
  if (email === "refresh") {
    const answer = verifiedAfterRefresh(await gate.refreshEmail(session, deadline));
    if (answer === "verify") return redirect("/verify-email", false);
  }
  return { session, privacyNotice: decision.outcome === "pass" && decision.privacyNotice };
}
