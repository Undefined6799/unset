// The claim and end of an idx.account_job row, for every kind (account state, handle checks, backfills). A claim is
// the due time it set; any newer request for the same DID and kind moves the due time, so an old claim then ends
// nothing.
import type { PoolClient } from "./pool.ts";

/**
 * Claims due jobs of one kind for `leaseSeconds` by moving their due time; the new due time, as text to the
 * microsecond, is the claim. Locks only job rows and skips locked ones, so it never waits on erasure.
 */
export async function claimJobs<K extends string>(
  client: PoolClient,
  kind: K,
  limit: number,
  leaseSeconds: number,
): Promise<{ did: string; kind: K; attempts: number; claim: string }[]> {
  const { rows } = await client.query(
    `UPDATE idx.account_job j SET due_at = now() + make_interval(secs => $3)
       FROM (SELECT did FROM idx.account_job WHERE kind = $1 AND due_at <= now()
              ORDER BY due_at, did LIMIT $2 FOR UPDATE SKIP LOCKED) due
      WHERE j.did = due.did AND j.kind = $1
     RETURNING j.did, j.attempts, j.due_at::text AS claim`,
    [kind, limit, leaseSeconds],
  );
  return rows.map((row) => ({ did: String(row.did), kind, attempts: Number(row.attempts), claim: String(row.claim) }));
}

/** Ends the claimed job; false when the claim no longer matches. */
export async function endJob(
  tx: PoolClient,
  job: { readonly did: string; readonly kind: string; readonly claim: string },
): Promise<boolean> {
  const { rowCount } = await tx.query(
    "DELETE FROM idx.account_job WHERE did = $1 AND kind = $2 AND due_at = $3::timestamptz",
    [job.did, job.kind, job.claim],
  );
  return (rowCount ?? 0) > 0;
}
