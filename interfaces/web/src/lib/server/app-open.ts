// Whether the error page may offer a member the app's menus (P1.20k): not mid-onboarding, where each would only send
// them back to their step. An app route's gate has already passed the member; an onboarding route is the step itself.
// A path no route matches is the one case the gate decided nothing about, so only there is the account read (one
// query). A failed read offers no menus (the member stays signed in) and is logged by error class, never failing the
// page: the root layout's load runs for every page, and a throw there leaves only SvelteKit's bare fallback.
import { type Did, type OnboardingAccount, type OnboardingVersions, requireOnboarded } from "@unset/domains-identity";
import type { Logger } from "@unset/shared-log";
import type { RoutePolicy } from "./policy.ts";

export type AppOpenDeps = {
  readonly readAccount: (did: Did, deadline: AbortSignal) => Promise<OnboardingAccount | null>;
  readonly versions: OnboardingVersions;
  readonly log: Logger;
};

/** `route` is the matched route's policy, or null for a path no route matches. */
export async function appOpen(
  deps: AppOpenDeps,
  did: Did,
  route: RoutePolicy | null,
  deadline: AbortSignal,
): Promise<boolean> {
  if (route !== null) return route.session !== "onboarding";
  try {
    return requireOnboarded(await deps.readAccount(did, deadline), deps.versions).outcome === "pass";
  } catch (cause) {
    deps.log.warn("shell.account_read_failed", { kind: cause instanceof Error ? cause.name : "Error" });
    return false;
  }
}
