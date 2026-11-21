// Identity (plan §2 rules 1, 13; §5.2): who an account is. P2.01 resolves DIDs and handles and P2.02 verifies the
// handle; the network arrives through the IdentityNetwork contract (ADR 0013), which infrastructure/pds implements on
// net-guard.
export type { AccountRepository, UnderageBlockRecord } from "./account.ts";
export { ageInYears, type BirthDate, latestCalendarDay, parseBirthDate } from "./auth/age.ts";
export {
  cachedRecheckCapS,
  type EmailCache,
  type EmailGate,
  type EmailRefresh,
  emailGate,
  type Onboarding,
  type OnboardingAccount,
  type OnboardingDecision,
  type OnboardingStep,
  type OnboardingVersions,
  onboardingStep,
  requireOnboarded,
  verifiedAfterRefresh,
} from "./auth/gates.ts";
export type { FetchRequest, FetchTarget, HttpOutcome, IdentityNetwork, TxtOutcome } from "./contract.ts";
export type { ResolvedDid } from "./did-doc.ts";
export {
  type InviteRequestOutcome,
  type InviteRequestPorts,
  parseRequesterEmail,
  type RequesterEmail,
  requestInvite,
} from "./invite-requests.ts";
export {
  type InviteClaim,
  type InviteId,
  type InviteIssue,
  type InviteOutcome,
  type InvitePorts,
  type InviteRefusal,
  issueMemberInvite,
  joinCode,
  parseInviteId,
  parseSubmissionId,
  type SubmissionId,
} from "./invites.ts";
export { PRIVACY_VERSION, TERMS_VERSION } from "./legal/versions.ts";
export { type Actor, canonicalActorPath, parseActor } from "./profile-path.ts";
export {
  type Consistency,
  createDidResolver,
  type DidResolverOptions,
  IdentityError,
  type IdentityErrorKind,
} from "./resolve-did.ts";
export { type HandleResolution, resolveHandle } from "./resolve-handle.ts";
export {
  HISTORY_LIMIT,
  parseSignInId,
  parseSignInIds,
  SIGN_IN_KEEP_DAYS,
  type SignIn,
  type SignInHistory,
  type SignInId,
} from "./sign-in-history.ts";
export { type Did, type Handle, isHandleSyntax, parseDid, parseHandle } from "./syntax.ts";
export {
  createHandleVerifier,
  displayHandle,
  type HandleVerdict,
  type HandleVerifierOptions,
} from "./verify-handle.ts";
