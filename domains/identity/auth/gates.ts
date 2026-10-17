// Whether a signed-in account may pass the confirmed-email gate (P2.11; plan §5.3 "Email-verify gate"). Pure: the
// session store and the PDS call stay in the web server, because a domain does not import infrastructure.
export type EmailCache = { readonly confirmed: boolean | null; readonly checkedAt: Date | null };
export type EmailGate = "pass" | "refresh" | "verify";

/** `pass` uses the cache. `refresh` asks the PDS. `verify` sends the browser to `/verify-email` with no PDS call. */
export function emailGate(cache: EmailCache, nowMs: number, recheckS: number): EmailGate {
  if (cache.confirmed !== true) return "verify";
  if (cache.checkedAt === null) return "refresh";
  const ageS = (nowMs - cache.checkedAt.getTime()) / 1000;
  return ageS >= 0 && ageS <= recheckS ? "pass" : "refresh";
}

/**
 * The gate after a stale cache. A PDS outage keeps a previously confirmed member in (`transient`). A fresh `false`
 * sends them to confirm. Anything else is not a pass.
 */
export function verifiedAfterRefresh(answer: "transient" | "confirmed" | "unconfirmed"): "pass" | "verify" {
  return answer === "unconfirmed" ? "verify" : "pass";
}

/** Where an account is in onboarding. `blocked_underage` is terminal. */
export type Onboarding = "age" | "terms" | "chat" | "done" | "blocked_underage";

/** The row the gate reads. A missing row is an account that has not started. */
export type OnboardingAccount = {
  readonly onboarding: Onboarding;
  readonly termsVersion: string | null;
  readonly privacyVersion: string | null;
};

export type OnboardingVersions = { readonly terms: string; readonly privacy: string };

/** The screen a visitor should be on, or `done` when the app may open. */
export type OnboardingStep = "age" | "terms" | "chat" | "blocked" | "done";

/**
 * The first unfinished step (P2.12). A terms-version change sends a finished account back to terms only. A privacy
 * change does not: that is a notice, decided by `requireOnboarded`.
 */
export function onboardingStep(account: OnboardingAccount | null, versions: OnboardingVersions): OnboardingStep {
  if (account === null) return "age";
  switch (account.onboarding) {
    case "age":
      return "age";
    case "terms":
      return "terms";
    case "chat":
      return "chat";
    case "blocked_underage":
      return "blocked";
    case "done":
      return account.termsVersion === versions.terms ? "done" : "terms";
    default: {
      const unexpected: never = account.onboarding;
      return unexpected;
    }
  }
}

export type OnboardingDecision =
  | { readonly outcome: "pass"; readonly privacyNotice: boolean }
  | { readonly outcome: "welcome" }
  | { readonly outcome: "terms" }
  | { readonly outcome: "blocked" };

/**
 * Whether an app page may render (P2.12). Pass means onboarding is done and the accepted terms are current. A privacy
 * bump sets `privacyNotice` and does not redirect. Anything else is a redirect the caller makes.
 */
export function requireOnboarded(account: OnboardingAccount | null, versions: OnboardingVersions): OnboardingDecision {
  const step = onboardingStep(account, versions);
  switch (step) {
    case "done":
      return {
        outcome: "pass",
        privacyNotice: account !== null && account.privacyVersion !== versions.privacy,
      };
    case "terms":
      return { outcome: "terms" };
    case "blocked":
      return { outcome: "blocked" };
    case "age":
    case "chat":
      return { outcome: "welcome" };
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
}
