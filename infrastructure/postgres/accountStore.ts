// The account-state machine's writer for our PDS's confirmations (book P3.06s; plan §5.2: a change to inactive applies
// at once, a change to active or `deleted` is only a trigger, confirmed against the account's PDS). The getRepoStatus
// call happens before these calls; each call is one short transaction as `indexer` (rule DA-4).
//
// Lock order, as on every path that writes for a DID: the erasure lock (isErased), then the account row FOR UPDATE.
// An erased DID is never revealed and gets no writes.
//
// Deletion is confirmed but not yet erased: the indexer has no EXECUTE on core.erase_did until P3.06e (a trusted-base
// grant, Alex's line). Until then a member who deleted their account at the PDS keeps rows here, hidden from every
// reader (idx.visible_account) but not erased; each such account is a `deletion_confirmed_not_erased` dead letter,
// keeping the DID so P3.06e can erase it, and is counted on health. P3.06e is required before production.
import { count, hideAccount, isErased, lockAccount, queueJob } from "./indexStore.ts";
import { type Pool, type PoolClient, withClient } from "./pool.ts";
import { withTransaction } from "./tx.ts";

export type AccountJobKind = "confirm_status" | "confirm_deletion";
/**
 * A claimed job; `claim` is the due time the claim set, as text to the microsecond. A later request, or a status the
 * stream applies meanwhile (hideAccount), moves the due time to now, so an answer read before it changes nothing.
 */
export type AccountJob = {
  readonly did: string;
  readonly kind: AccountJobKind;
  readonly attempts: number;
  readonly claim: string;
};

/** Our PDS's answer, as the repo status reader classifies it; `unavailable` goes to `failed` instead. */
export type ConfirmedStatus =
  | { readonly kind: "active" }
  | { readonly kind: "inactive"; readonly status: string | null }
  | { readonly kind: "not_found" };

export type AccountStore = {
  /** Claims due jobs of one kind, at most `limit`, for CONFIRM_LEASE_SECONDS: another pass will not take them. */
  readonly dueJobs: (kind: AccountJobKind, limit: number) => Promise<AccountJob[]>;
  /** Applies a confirmation and ends the job. */
  readonly confirmed: (job: AccountJob, answer: ConfirmedStatus) => Promise<void>;
  /** Our PDS could not answer: backs the job off, or gives up after MAX_CONFIRM_DAYS with a dead letter. */
  readonly failed: (job: AccountJob) => Promise<void>;
};

/** How long a claimed job is left alone; a pass that died is retried after it. Above the status read's deadline. */
export const CONFIRM_LEASE_SECONDS = 300;
/** Days a job keeps retrying an unavailable PDS (book P3.06: "retry with backoff for 7 days, then alert"). */
export const MAX_CONFIRM_DAYS = 7;
/** The wait after the n-th failure (book P3.06: 1, 5, 25 minutes, then hourly). */
export const confirmDelaySeconds = (attempts: number): number => [60, 300, 1500][attempts - 1] ?? 3600;

export function createAccountStore(pool: Pool, options: { readonly timeoutMs: number }): AccountStore {
  const deadline = () => AbortSignal.timeout(options.timeoutMs);
  return {
    // Locks only job rows and never waits on the erasure lock (SKIP LOCKED), so it cannot deadlock with erasure.
    dueJobs: (kind, limit) =>
      withClient(pool, deadline(), async (client) => {
        const { rows } = await client.query(
          `UPDATE idx.account_job j SET due_at = now() + make_interval(secs => $3)
             FROM (SELECT did FROM idx.account_job WHERE kind = $1 AND due_at <= now()
                    ORDER BY due_at, did LIMIT $2 FOR UPDATE SKIP LOCKED) due
            WHERE j.did = due.did AND j.kind = $1
           RETURNING j.did, j.attempts, j.due_at::text AS claim`,
          [kind, limit, CONFIRM_LEASE_SECONDS],
        );
        return rows.map((row) => ({
          did: String(row.did),
          kind,
          attempts: Number(row.attempts),
          claim: String(row.claim),
        }));
      }),
    confirmed: (job, answer) => withTransaction(pool, deadline(), (tx) => applyConfirmation(tx, job, answer)),
    failed: (job) => withTransaction(pool, deadline(), (tx) => confirmFailed(tx, job)),
  };
}

async function applyConfirmation(tx: PoolClient, job: AccountJob, answer: ConfirmedStatus): Promise<void> {
  const account = (await isErased(tx, job.did)) ? null : await lockAccount(tx, job.did);
  // The answer was read before anything that moved the claim: a newer request or a status the stream applied. It
  // changes nothing; the job, due again, asks afresh.
  if (!(await endJob(tx, job))) return count(tx, "account_job_superseded");
  if (account === null) return count(tx, "account_job_skipped");
  if (job.kind === "confirm_status") return confirmStatus(tx, job.did, answer);
  return confirmDeletion(tx, job.did, answer);
}

/** Book P3.06 `confirm_status` steps 2 to 4. */
async function confirmStatus(tx: PoolClient, did: string, answer: ConfirmedStatus): Promise<void> {
  if (answer.kind === "not_found") return deletionTrigger(tx, did);
  if (answer.kind === "inactive") {
    await hideAccount(tx, did, answer.status);
    if (answer.status === "deleted") await queueJob(tx, did, "confirm_deletion");
    return count(tx, "account_confirmed_inactive");
  }
  // Active: revealed only if a deletion is not pending. A backfill follows, and it removes whatever the stream missed
  // while the account was inactive (in place of the book's listRecords reconcile: the backfill is verified).
  const { rowCount } = await tx.query(
    `UPDATE idx.account SET pds_active = true, pds_status = NULL, updated_at = now()
     WHERE did = $1 AND NOT pds_active AND pds_status IS DISTINCT FROM 'deleted'`,
    [did],
  );
  if (rowCount === 0) return count(tx, "account_job_skipped");
  await queueJob(tx, did, "backfill");
  await count(tx, "account_confirmed_active");
}

async function deletionTrigger(tx: PoolClient, did: string): Promise<void> {
  await hideAccount(tx, did, "deleted");
  await queueJob(tx, did, "confirm_deletion");
  await count(tx, "account_confirmed_inactive");
}

/** Book P3.06 `confirm_deletion` steps 2 and 3, without the erasure (P3.06e). */
async function confirmDeletion(tx: PoolClient, did: string, answer: ConfirmedStatus): Promise<void> {
  const gone = answer.kind === "not_found" || (answer.kind === "inactive" && answer.status === "deleted");
  if (gone) {
    await hideAccount(tx, did, "deleted");
    await tx.query(
      `INSERT INTO idx.dead_letter (kind, did, reason_code, attempts, first_seen, last_seen)
       SELECT 'track', $1::types.did, 'deletion_confirmed_not_erased', 1, now(), now()
       WHERE NOT EXISTS (
         SELECT 1 FROM idx.dead_letter WHERE did = $1 AND reason_code = 'deletion_confirmed_not_erased')`,
      [did],
    );
    return count(tx, "account_deletion_confirmed");
  }
  // The repo exists and is not deleted: the `deleted` status is cleared, and the account stays hidden until
  // confirm_status confirms it active.
  if (answer.kind === "inactive") await hideAccount(tx, did, answer.status);
  else {
    await tx.query("UPDATE idx.account SET pds_status = NULL, updated_at = now() WHERE did = $1", [did]);
    await queueJob(tx, did, "confirm_status");
  }
  await count(tx, "account_deletion_not_confirmed");
}

/** Never hides, reveals or erases on an error: the account stays as it is while the job backs off. */
async function confirmFailed(tx: PoolClient, job: AccountJob): Promise<void> {
  const erased = await isErased(tx, job.did); // the erasure lock first, as on every path
  const { rows } = await tx.query(
    `SELECT first_queued_at > now() - make_interval(days => $3) AS retry FROM idx.account_job
     WHERE did = $1 AND kind = $2 AND due_at = $4::timestamptz FOR UPDATE`,
    [job.did, job.kind, MAX_CONFIRM_DAYS, job.claim],
  );
  if (rows[0] === undefined) return; // ended or asked for again meanwhile: the newer request stands
  const attempts = job.attempts + 1;
  await count(tx, "account_job_failed");
  if (rows[0].retry === true) {
    await tx.query(
      "UPDATE idx.account_job SET attempts = $3, due_at = now() + make_interval(secs => $4) WHERE did = $1 AND kind = $2",
      [job.did, job.kind, attempts, confirmDelaySeconds(attempts)],
    );
    return;
  }
  // As for the stream's and the backfill's dead letters, the DID is kept only while tracked and not erased (SE-7).
  const keep = !erased && (await lockAccount(tx, job.did)) !== null;
  await tx.query(
    `INSERT INTO idx.dead_letter (kind, did, reason_code, attempts, first_seen, last_seen)
     SELECT 'track', $1, $2, $3, first_queued_at, now() FROM idx.account_job WHERE did = $4 AND kind = $5`,
    [keep ? job.did : null, `${job.kind}_unavailable`, attempts, job.did, job.kind],
  );
  await endJob(tx, job);
  await count(tx, "account_job_dead_letter");
}

/** Ends the claimed job; false when the claim no longer matches. */
async function endJob(tx: PoolClient, job: AccountJob): Promise<boolean> {
  const { rowCount } = await tx.query(
    "DELETE FROM idx.account_job WHERE did = $1 AND kind = $2 AND due_at = $3::timestamptz",
    [job.did, job.kind, job.claim],
  );
  return (rowCount ?? 0) > 0;
}
