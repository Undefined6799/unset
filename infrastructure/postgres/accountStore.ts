// The account-state machine's writer for our PDS's confirmations (book P3.06s; plan §5.2: a change to inactive applies
// at once, a change to active or `deleted` is only a trigger, confirmed against the account's PDS). The getRepoStatus
// call happens before these calls; each call is one short transaction as `indexer` (rule DA-4).
//
// Lock order: the erasure lock (isErased) first, as on every path that writes for a DID; it serialises everything
// below for that DID. Then a confirmation locks the account row and then its job row, and a failure locks the job row
// and then the account row. An erased DID is never revealed and gets no writes.
//
// A confirmed deletion is erased through idx.erase_deleted_account (P3.06e, migration 0029): reason fixed to
// account_deleted, only for an account held hidden as deleted, and at most 20 an hour. Past the cap the account stays
// hidden and the job asks again an hour later; an operator can erase sooner through the owner's path.
import { count, hideAccount, isErased, lockAccount, queueJob } from "./indexStore.ts";
import { claimJobs, endJob } from "./jobs.ts";
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
  /** Counts for the health board; no DID (rule SE-7). */
  readonly health: () => Promise<AccountHealth>;
};

export type AccountHealth = {
  /**
   * Accounts held hidden as deleted with a confirm_deletion job still queued: waiting for our PDS to answer or, past
   * P3.06e's hourly erase cap, for the next hour. A count that keeps growing means erasures fall behind.
   */
  readonly deletionsWaiting: number;
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
    dueJobs: (kind, limit) =>
      withClient(pool, deadline(), (client) => claimJobs(client, kind, limit, CONFIRM_LEASE_SECONDS)),
    confirmed: (job, answer) => withTransaction(pool, deadline(), (tx) => applyConfirmation(tx, job, answer)),
    failed: (job) => withTransaction(pool, deadline(), (tx) => confirmFailed(tx, job)),
    health: () =>
      withClient(pool, deadline(), async (client) => {
        const { rows } = await client.query(
          `SELECT count(*) AS n FROM idx.account a
           WHERE a.pds_status = 'deleted' AND NOT a.pds_active
             AND EXISTS (SELECT 1 FROM idx.account_job j WHERE j.did = a.did AND j.kind = 'confirm_deletion')`,
        );
        return { deletionsWaiting: Number(rows[0]?.n ?? 0) };
      }),
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
  if (rowCount === 0) {
    // Held as deleted, yet active now: the deletion is asked about again rather than kept hidden for good, and a
    // "not deleted" answer clears it (confirmDeletion). Already shown: nothing to do.
    await tx.query(
      `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
       SELECT did, 'confirm_deletion', now(), 0, now() FROM idx.account WHERE did = $1 AND pds_status = 'deleted'
       ON CONFLICT (did, kind) DO UPDATE SET due_at = LEAST(idx.account_job.due_at, excluded.due_at)`,
      [did],
    );
    return count(tx, "account_job_skipped");
  }
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
    return eraseDeleted(tx, did);
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

/**
 * Erases the account, or, past the hourly cap (the function returns NULL and erases nothing), leaves it hidden and asks
 * again in an hour. core.erase_did deletes the account row and its jobs; the tombstone keeps it erased.
 */
async function eraseDeleted(tx: PoolClient, did: string): Promise<void> {
  const { rows } = await tx.query("SELECT idx.erase_deleted_account($1) AS result", [did]);
  if (rows[0]?.result != null) return count(tx, "account_deletion_erased");
  await tx.query(
    `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
     VALUES ($1, 'confirm_deletion', now() + interval '1 hour', 0, now())
     ON CONFLICT (did, kind) DO UPDATE SET due_at = excluded.due_at`,
    [did],
  );
  await count(tx, "account_erase_capped");
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
