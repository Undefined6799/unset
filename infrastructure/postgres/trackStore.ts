// The index's writer for the track queue and the getRepo backfill (book P3.02s and P3.05s; ADR 0052 decisions 3 and
// 5). Network I/O (resolving a DID, reading a repo) happens before these calls; each call is one short transaction as
// `indexer` (rule DA-4). Concurrency: the account row is taken FOR UPDATE, the lock ingest takes too, so a backfill
// and a stream frame for the same account apply one after the other, and the rev guards on each row decide which
// write stands.
//
// An erased DID is checked first under every path (P3.07s): it is never tracked again and a backfill never writes it.
// Lock order on every path that writes for a DID: the erasure lock (isErased takes core.erase_did's own per-DID
// advisory lock, migration 0028 step 3) before any of that DID's rows, as erasure itself does; core.erase_did never
// touches idx.relay_cursor, so the stream's cursor row, taken first on the ingest path, cannot deadlock with it.
import { type IndexChange, planCommit } from "@unset/domains-profile";
import { applyWrite, count, isErased, lockAccount, queueJob, replaceBlobs } from "./indexStore.ts";
import { type Pool, type PoolClient, withClient } from "./pool.ts";
import { withTransaction } from "./tx.ts";

export type TrackOutcome = "tracked" | "erased" | "foreign";
export type BackfillJob = { readonly did: string; readonly attempts: number };
/** Why a backfill failed; `gone` means the PDS no longer serves the repo, which the account-state machine handles. */
export type BackfillFailure = "gone" | "failed";

export type TrackStore = {
  /** The oldest track requests, at most `limit`, leaving out `skip` (DIDs waiting to be resolved again). */
  readonly pendingTracks: (limit: number, skip: readonly string[]) => Promise<string[]>;
  /** Deletes the request of a DID that could not be resolved after repeated attempts, and counts it. */
  readonly dropUnresolved: (did: string) => Promise<void>;
  /**
   * Settles one request. A DID whose PDS is ours gets its account row (inactive until the account-state machine
   * confirms it, book P3.06s) and its confirm_status and backfill jobs; any other DID is dropped and counted, since
   * this slice indexes only our PDS (book P3.02s). The request row is deleted either way.
   */
  readonly track: (did: string, hosted: boolean) => Promise<TrackOutcome>;
  /** Backfill jobs that are due, oldest first, at most `limit`. */
  readonly dueBackfills: (limit: number) => Promise<BackfillJob[]>;
  /** Writes a verified repo snapshot; see applySnapshot. */
  readonly applySnapshot: (did: string, rev: string, records: readonly IndexChange[]) => Promise<void>;
  /** Backs the job off, or dead-letters it after MAX_BACKFILL_ATTEMPTS; a `gone` repo ends the job at once. */
  readonly backfillFailed: (job: BackfillJob, failure: BackfillFailure) => Promise<void>;
};

/** Attempts before a backfill job is dead-lettered (about a day with the backoff below). */
export const MAX_BACKFILL_ATTEMPTS = 12;
/** The wait after the n-th failure: one minute doubling, at most six hours. */
export const backfillDelaySeconds = (attempts: number): number => Math.min(60 * 2 ** attempts, 6 * 3600);

export function createTrackStore(pool: Pool, options: { readonly timeoutMs: number }): TrackStore {
  const deadline = () => AbortSignal.timeout(options.timeoutMs);
  const inTx = <T>(fn: (tx: PoolClient) => Promise<T>) => withTransaction(pool, deadline(), fn);
  return {
    pendingTracks: (limit, skip) =>
      withClient(pool, deadline(), async (client) => {
        const { rows } = await client.query(
          `SELECT did FROM idx.track_request WHERE NOT (did::text = ANY($2::text[]))
           ORDER BY requested_at, did LIMIT $1`,
          [limit, skip],
        );
        return rows.map((row) => String(row.did));
      }),
    dropUnresolved: (did) =>
      inTx(async (tx) => {
        await isErased(tx, did); // the erasure lock first, as on every path
        await tx.query("DELETE FROM idx.track_request WHERE did = $1", [did]);
        await count(tx, "track_unresolved");
      }),
    track: (did, hosted) => inTx((tx) => trackOne(tx, did, hosted)),
    dueBackfills: (limit) =>
      withClient(pool, deadline(), async (client) => {
        const { rows } = await client.query(
          `SELECT did, attempts FROM idx.account_job WHERE kind = 'backfill' AND due_at <= now()
           ORDER BY due_at, did LIMIT $1`,
          [limit],
        );
        return rows.map((row) => ({ did: String(row.did), attempts: Number(row.attempts) }));
      }),
    applySnapshot: (did, rev, records) => inTx((tx) => applySnapshot(tx, did, rev, records)),
    backfillFailed: (job, failure) => inTx((tx) => backfillFailed(tx, job, failure)),
  };
}

async function trackOne(tx: PoolClient, did: string, hosted: boolean): Promise<TrackOutcome> {
  // The erasure lock comes before any row of this DID: core.erase_did takes it first and then deletes the request
  // row, so the other order could deadlock with it.
  const erased = await isErased(tx, did);
  await tx.query("DELETE FROM idx.track_request WHERE did = $1", [did]);
  if (erased) {
    await count(tx, "track_erased");
    return "erased";
  }
  if (!hosted) {
    await count(tx, "track_foreign");
    return "foreign";
  }
  // Never touches an existing row's state: pds_active stays as the account-state machine left it.
  await tx.query(
    `INSERT INTO idx.account (did, track_requested_at, updated_at) VALUES ($1, now(), now())
     ON CONFLICT (did) DO UPDATE SET track_requested_at = excluded.track_requested_at`,
    [did],
  );
  await queueJob(tx, did, "confirm_status");
  await queueJob(tx, did, "backfill");
  await count(tx, "track_added");
  return "tracked";
}

/**
 * Writes the account's records as its signed repo holds them at `rev`, then removes every indexed record the repo no
 * longer holds (`rev` below the snapshot's). That second step undoes a delete the stream missed or dead-lettered. A
 * snapshot older than the account's watermark writes nothing and the backfill comes again: the stream's later commit
 * may have deleted a row, and nothing would stop the snapshot restoring it. An erased, untracked or inactive account gets no
 * writes and its job ends; the account-state machine queues a new backfill when it confirms the account active.
 */
async function applySnapshot(tx: PoolClient, did: string, rev: string, records: readonly IndexChange[]) {
  const account = (await isErased(tx, did)) ? null : await lockAccount(tx, did);
  if (account === null || !account.active) {
    await endJob(tx, did);
    return count(tx, "backfill_skipped");
  }
  // The stream has applied a later commit since the repo was read. A row that commit deleted is gone, so no rev guard
  // is left to stop this older snapshot bringing it back: write nothing, and read the repo again on the next pass.
  // Revs are TIDs and compare as strings (atproto.com/specs/tid); the account row is locked, so the stream waits.
  if (account.lastRev !== null && account.lastRev > rev) {
    await queueJob(tx, did, "backfill");
    return count(tx, "backfill_stale");
  }
  const plan = planCommit({ lastRev: null, active: true }, rev, records);
  if (plan.kind !== "apply") throw new TypeError("a verified snapshot always has a signed rev");
  for (const write of plan.writes) await applyWrite(tx, did, rev, write);
  if (plan.skipped > 0) await count(tx, "ingest_invalid", plan.skipped);
  // Only what this snapshot wrote is kept: a record the repo holds but the plan skipped (invalid, over the cap) must
  // not leave an older indexed version of it public.
  const kept = plan.writes.flatMap((write) =>
    write.kind === "profile"
      ? [`at://${did}/sh.unset.profile/self`]
      : write.kind === "section"
        ? [`at://${did}/sh.unset.section/${write.rkey}`]
        : [],
  );
  for (const table of ["idx.profile", "idx.section"]) {
    const { rows } = await tx.query(
      `DELETE FROM ${table} WHERE did = $1 AND rev < ($2 COLLATE "C") AND NOT (uri = ANY($3::text[])) RETURNING uri`,
      [did, rev, kept],
    );
    for (const row of rows) await replaceBlobs(tx, did, String(row.uri), []);
    if (table === "idx.profile" && rows.length > 0) {
      await tx.query("UPDATE idx.section SET position = NULL WHERE did = $1", [did]);
    }
  }
  await tx.query(
    `UPDATE idx.account SET last_rev = GREATEST(last_rev, $2 COLLATE "C"), backfilled_at = now(), updated_at = now()
     WHERE did = $1`,
    [did, rev],
  );
  await endJob(tx, did);
  await count(tx, "backfill_applied");
}

async function backfillFailed(tx: PoolClient, job: BackfillJob, failure: BackfillFailure): Promise<void> {
  const erased = await isErased(tx, job.did); // the erasure lock first, as on every path
  const attempts = job.attempts + 1;
  if (failure === "gone") {
    await endJob(tx, job.did);
    return count(tx, "backfill_failed");
  }
  if (attempts < MAX_BACKFILL_ATTEMPTS) {
    await tx.query(
      `UPDATE idx.account_job SET attempts = $2, due_at = now() + make_interval(secs => $3)
       WHERE did = $1 AND kind = 'backfill'`,
      [job.did, attempts, backfillDelaySeconds(attempts)],
    );
    return count(tx, "backfill_failed");
  }
  // As for a stream frame, the DID is kept only while the account is tracked and not erased (rule SE-7, P3.07s).
  const keep = !erased && (await lockAccount(tx, job.did)) !== null;
  await tx.query(
    `INSERT INTO idx.dead_letter (kind, did, reason_code, attempts, first_seen, last_seen)
     SELECT 'backfill', $1, 'backfill_failed', $2, coalesce(
       (SELECT first_queued_at FROM idx.account_job WHERE did = $3 AND kind = 'backfill'), now()), now()`,
    [keep ? job.did : null, attempts, job.did],
  );
  await endJob(tx, job.did);
  await count(tx, "backfill_dead_letter");
}

async function endJob(tx: PoolClient, did: string): Promise<void> {
  await tx.query("DELETE FROM idx.account_job WHERE did = $1 AND kind = 'backfill'", [did]);
}
