// The account record (P2.12, plan §5.2) as the product reads and changes it. The domain owns this contract;
// infrastructure/postgres implements it on `app.account`, and each interface that needs the record is handed one by
// its composition root (ADR 0013 is the same shape for the network). Every method takes the caller's deadline.
import type { OnboardingAccount } from "./auth/gates.ts";
import type { Did } from "./syntax.ts";

/** The audit row an under-age block wrote: its lane and its sequence number there. */
export type UnderageBlockRecord = { readonly lane: string; readonly seq: number };

export type AccountRepository = {
  /** The record, or null for an account that has not started onboarding. */
  get(did: Did, deadline: AbortSignal): Promise<OnboardingAccount | null>;
  /** Moves the age step to terms and records when; the birth date is never passed. False from any other step. */
  confirmAdult(did: Did, deadline: AbortSignal): Promise<boolean>;
  /** Records the accepted versions. From terms the step becomes chat; a finished account stays done. */
  acceptTerms(did: Did, terms: string, privacy: string, deadline: AbortSignal): Promise<"chat" | "done" | null>;
  finishChat(did: Did, deadline: AbortSignal): Promise<boolean>;
  /**
   * Records that a finished account dismissed the changed-notice banner for this privacy version (P2.12b). A seen
   * record, never an acceptance: `privacyVersion` is not touched. False when no finished account matched.
   */
  markPrivacyNoticeSeen(did: Did, privacy: string, deadline: AbortSignal): Promise<boolean>;
  /**
   * Blocks the account and writes its audit row, together or not at all. Null means this call did not change the
   * record (it was already past the age step), so no second audit row exists.
   */
  blockUnderage(did: Did, hosted: boolean, deadline: AbortSignal): Promise<UnderageBlockRecord | null>;
};
