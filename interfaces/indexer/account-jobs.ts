// One pass of the account-state jobs (book P3.06s): `confirm_status` and `confirm_deletion` ask our PDS for the
// account's hosting status (getRepoStatus through net-guard) before the store's short transaction (rule DA-4). The
// process that runs this pass on a timer comes with its compose service (P3.05s PR 3). A job whose transaction fails
// stays due and is tried again on the next pass; it never stops the others.
import type { RepoStatusReader } from "@unset/infrastructure-firehose";
import type { AccountJobKind, AccountStore } from "@unset/infrastructure-postgres";
import { withDeadline } from "./track.ts";

/** Jobs of each kind per pass (book P3.06: batch 20, every 10 s). */
export const CONFIRM_BATCH = 20;
const KINDS: readonly AccountJobKind[] = ["confirm_status", "confirm_deletion"];

export type ConfirmDeps = {
  readonly store: Pick<AccountStore, "dueJobs" | "confirmed" | "failed">;
  readonly readStatus: RepoStatusReader;
  readonly timeoutMs: number;
  /** The process's stop: a status read it cuts short is not recorded as the job's failure. */
  readonly signal: AbortSignal;
};

export type ConfirmPass = { readonly confirmed: number; readonly unavailable: number; readonly failed: number };

export async function confirmPass(deps: ConfirmDeps): Promise<ConfirmPass> {
  let confirmed = 0;
  let unavailable = 0;
  let failed = 0;
  for (const kind of KINDS) {
    for (const job of await deps.store.dueJobs(kind, CONFIRM_BATCH)) {
      if (deps.signal.aborted) return { confirmed, unavailable, failed };
      try {
        const answer = await deps.readStatus(job.did, withDeadline(deps.signal, deps.timeoutMs));
        if (deps.signal.aborted) return { confirmed, unavailable, failed };
        if (answer.kind === "unavailable") {
          unavailable += 1;
          await deps.store.failed(job);
        } else {
          await deps.store.confirmed(job, answer);
          confirmed += 1;
        }
      } catch {
        if (deps.signal.aborted) return { confirmed, unavailable, failed };
        failed += 1;
      }
    }
  }
  return { confirmed, unavailable, failed };
}
