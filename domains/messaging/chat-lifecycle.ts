// The chat account follows the Unset account (ADR 0084). Erasure: core.erase_did keeps an erased member's chat user,
// with no DID, in a queue (migration 0037), and this job asks chat-admin to deactivate each one, which ends every
// session and asks the homeserver to erase the account (decision 3). It retries until chat-admin has done it and never
// gives up (decision 4: chat cannot be forgotten); a row stuck long is counted so the log shows it. The ports are I/O
// only (rule AB-2).
import { type ChatUser, retryDelayS } from "./chat-account.ts";

/** chat-admin's answer to a lock, unlock or deactivate: done, an account it never made, refused, or no answer. */
export type ChatAccountChange =
  | { readonly kind: "done" }
  | { readonly kind: "no_account" }
  | { readonly kind: "rejected" }
  | { readonly kind: "unavailable" };

/** One claimed erasure: the chat user, the attempts already failed, and the lease that fences its writes. */
export type ChatErasureJob = { readonly user: ChatUser; readonly attempts: number; readonly lease: string };

export type ChatErasurePorts = {
  /** Claims one due erasure under a fresh lease, in a short transaction of its own; null when none is due. */
  readonly claim: () => Promise<ChatErasureJob | null>;
  readonly deactivate: (user: ChatUser) => Promise<ChatAccountChange>;
  /** Deletes the row if the job still holds its lease; false when it no longer does. */
  readonly finish: (job: ChatErasureJob) => Promise<boolean>;
  /** Puts the row back, one attempt more, due in `inS` seconds, if the job still holds its lease. */
  readonly retry: (job: ChatErasureJob, inS: number) => Promise<boolean>;
};

/** After this many failed attempts (about a day at the hourly step) a row counts as stuck, and still retries. */
export const ERASE_STUCK_ATTEMPTS = 24;

export type ErasureCounts = { erased: number; retry: number; lost: number; stuck: number };

/**
 * Deactivates up to `limit` due chat accounts, one at a time, each claimed just before its call and settled only if
 * its lease still holds; no transaction or connection is held across the call (rule DA-4). An account chat-admin
 * never made has nothing to erase. An unexpected error is not caught: the row keeps its lease and comes back.
 */
export async function eraseDueAccounts(ports: ChatErasurePorts, limit: number): Promise<ErasureCounts> {
  const counts: ErasureCounts = { erased: 0, retry: 0, lost: 0, stuck: 0 };
  for (let n = 0; n < limit; n++) {
    const job = await ports.claim();
    if (job === null) break;
    const answer = await ports.deactivate(job.user);
    const gone = answer.kind === "done" || answer.kind === "no_account";
    const kept = gone ? await ports.finish(job) : await ports.retry(job, retryDelayS(job.attempts + 1));
    if (!kept) counts.lost += 1;
    else if (gone) counts.erased += 1;
    else counts.retry += 1;
    if (!gone && job.attempts >= ERASE_STUCK_ATTEMPTS) counts.stuck += 1;
  }
  return counts;
}
