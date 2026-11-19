// The handle check's writer (book P3.08s; plan §5.2 "handles in events are hints only"). The check runs before these
// calls (interfaces/indexer/handles.ts: verifyHandle fresh, and our PDS's word for our hosted names); each call here is
// one short transaction as `indexer` (rule DA-4).
//
// Lock order, as in accountStore.ts: the erasure lock (isErased), then the account row, then its job row. A verified
// handle then locks the rows of any other verified holder of it, to move them to 'unresolved'. Only this pass writes
// handles and it runs one job at a time, so two transactions never lock those rows in opposite order; if one ever did,
// Postgres would abort one and its job would be claimed again. Migration 0031 refuses a second verified holder either way.
import { claimJobs, endJob } from "./accountStore.ts";
import { count, isErased, lockAccount, queueJob } from "./indexStore.ts";
import { type Pool, type PoolClient, withClient } from "./pool.ts";
import { withTransaction } from "./tx.ts";

/** A claimed handle check; `claim` as in AccountJob: a newer request moves it, and the old answer then writes nothing. */
export type HandleJob = {
  readonly did: string;
  readonly kind: "handle_check";
  readonly attempts: number;
  readonly claim: string;
};

/** What the check found; `unresolved` is an outage on either side and keeps what is stored. */
export type HandleOutcome =
  | { readonly status: "verified"; readonly handle: string }
  | { readonly status: "invalid" }
  | { readonly status: "unresolved"; readonly claimed?: string };

export type HandleStore = {
  /**
   * Queues a check for accounts never checked or last checked more than `maxAgeSeconds` ago, oldest first, at most
   * `limit`; returns how many it queued. An account with a check already queued is left alone.
   */
  readonly queueStale: (limit: number, maxAgeSeconds: number) => Promise<number>;
  /** Claims due checks, at most `limit`, for HANDLE_LEASE_SECONDS. */
  readonly dueChecks: (limit: number) => Promise<HandleJob[]>;
  /** Writes the outcome and ends the job, unless a newer request moved the claim meanwhile. */
  readonly checked: (job: HandleJob, outcome: HandleOutcome) => Promise<void>;
};

/**
 * How long a claimed check is left alone: above the longest check, four reads of INDEXER_TIMEOUT_MS (handles.ts), at
 * most 4 x 30 s = 120 s, so a slow check never runs twice at once.
 */
export const HANDLE_LEASE_SECONDS = 150;
/** An unresolved check asks again after this, rather than on every pass until the outage ends. */
export const HANDLE_RETRY_SECONDS = 600;

export function createHandleStore(pool: Pool, options: { readonly timeoutMs: number }): HandleStore {
  const deadline = () => AbortSignal.timeout(options.timeoutMs);
  return {
    queueStale: (limit, maxAgeSeconds) =>
      withClient(pool, deadline(), async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
           SELECT a.did, 'handle_check', now(), 0, now() FROM idx.account a
            WHERE (a.handle_checked_at IS NULL OR a.handle_checked_at < now() - make_interval(secs => $2))
              AND NOT EXISTS (SELECT 1 FROM idx.account_job j WHERE j.did = a.did AND j.kind = 'handle_check')
            ORDER BY a.handle_checked_at NULLS FIRST, a.did LIMIT $1
           ON CONFLICT (did, kind) DO NOTHING`,
          [limit, maxAgeSeconds],
        );
        return rowCount ?? 0;
      }),
    dueChecks: (limit) =>
      withClient(pool, deadline(), (client) => claimJobs(client, "handle_check" as const, limit, HANDLE_LEASE_SECONDS)),
    checked: (job, outcome) => withTransaction(pool, deadline(), (tx) => writeOutcome(tx, job, outcome)),
  };
}

async function writeOutcome(tx: PoolClient, job: HandleJob, outcome: HandleOutcome): Promise<void> {
  const account = (await isErased(tx, job.did)) ? null : await lockAccount(tx, job.did);
  if (!(await endJob(tx, job))) return count(tx, "account_job_superseded");
  if (account === null) return count(tx, "account_job_skipped");
  if (outcome.status === "unresolved") return askAgainLater(tx, job.did, outcome.claimed);
  if (outcome.status === "invalid") {
    await tx.query(
      `UPDATE idx.account SET handle = NULL, handle_status = 'invalid', handle_checked_at = now(), updated_at = now()
       WHERE did = $1`,
      [job.did],
    );
    return count(tx, "handle_invalid");
  }
  const handle = outcome.handle.toLowerCase();
  await moveOtherHolders(tx, job.did, handle);
  await tx.query(
    `UPDATE idx.account SET handle = $2, handle_status = 'verified', handle_checked_at = now(), updated_at = now()
     WHERE did = $1`,
    [job.did, handle],
  );
  await count(tx, "handle_verified");
}

/** Book P3.08 step 5: another account verified this handle before; it is asked again and is no longer verified. */
async function moveOtherHolders(tx: PoolClient, did: string, handle: string): Promise<void> {
  const { rows } = await tx.query(
    `UPDATE idx.account SET handle_status = 'unresolved', updated_at = now()
     WHERE handle = $2 AND handle_status = 'verified' AND did <> $1 RETURNING did`,
    [did, handle],
  );
  for (const row of rows) await queueJob(tx, String(row.did), "handle_check");
  if (rows.length > 0) await count(tx, "handle_moved", rows.length);
}

/**
 * An outage says nothing about the handle, so the check is due again later. What is stored stays verified only while
 * the DID document still claims it: when the document was read and claims another handle, the stored one is no longer
 * verified (the public page then shows the DID), and the next check decides (review B1 on #1728).
 */
async function askAgainLater(tx: PoolClient, did: string, claimed: string | undefined): Promise<void> {
  if (claimed !== undefined) {
    const { rowCount } = await tx.query(
      `UPDATE idx.account SET handle_status = 'unresolved', updated_at = now()
       WHERE did = $1 AND handle_status = 'verified' AND handle IS DISTINCT FROM $2`,
      [did, claimed.toLowerCase()],
    );
    if ((rowCount ?? 0) > 0) await count(tx, "handle_unclaimed");
  }
  await tx.query(
    `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
     VALUES ($1, 'handle_check', now() + make_interval(secs => $2), 0, now())
     ON CONFLICT (did, kind) DO NOTHING`,
    [did, HANDLE_RETRY_SECONDS],
  );
  await count(tx, "handle_unresolved");
}
