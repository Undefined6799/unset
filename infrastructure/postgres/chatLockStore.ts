// The chat account's lock (migration 0043; ADR 0084 decisions 1 and 2): the ready accounts whose lock differs from
// their member's state, read through app.chat_lock_due, claimed under a lease and settled once chat-admin has done
// the change. A claim is one statement that locks app.chat_account rows with SKIP LOCKED; a settle or retry writes
// only while that lease holds (rule DA-4). Every statement names the row by its DID.
import type { Did } from "@unset/domains-identity";
import { type ChatLockJob, parseChatUser } from "@unset/domains-messaging";
import type { Pool } from "./pool.ts";
import { withClient } from "./pool.ts";

export type ChatLockStore = {
  claim(limit: number): Promise<ChatLockJob[]>;
  settle(job: ChatLockJob): Promise<boolean>;
  retry(job: ChatLockJob, inS: number): Promise<boolean>;
};

const CLAIM = `UPDATE app.chat_account c SET lock_due_at = now() + make_interval(secs => $2),
    lock_lease = gen_random_uuid()
  FROM (SELECT a.did, d.want_locked FROM app.chat_account a JOIN app.chat_lock_due d USING (did)
         WHERE a.lock_due_at <= now() ORDER BY a.lock_due_at, a.did LIMIT $1 FOR UPDATE OF a SKIP LOCKED) due
 WHERE c.did = due.did
 RETURNING c.did, c.chat_user, due.want_locked, c.lock_attempts, c.lock_lease::text AS lease`;

const SETTLE = `UPDATE app.chat_account SET locked = $3, lock_attempts = 0, lock_due_at = now(), lock_lease = NULL
 WHERE did = $1 AND lock_lease = $2::uuid`;

const RETRY = `UPDATE app.chat_account SET lock_attempts = lock_attempts + 1,
    lock_due_at = now() + make_interval(secs => $3), lock_lease = NULL
 WHERE did = $1 AND lock_lease = $2::uuid`;

function jobOf(row: Record<string, unknown>): ChatLockJob {
  const user = parseChatUser(row.chat_user);
  if (user === null || typeof row.lease !== "string" || typeof row.want_locked !== "boolean") {
    throw new Error("chat_account lock row");
  }
  return { did: row.did as Did, user, lock: row.want_locked, attempts: Number(row.lock_attempts), lease: row.lease };
}

/** `leaseS`: seconds a claim holds its row, longer than one chat-admin call. */
export function createChatLockStore(pool: Pool, options: { readonly leaseS: number }): ChatLockStore {
  const run = async (sql: string, values: unknown[]) =>
    withClient(pool, null, (db) => db.query<Record<string, unknown>>(sql, values));
  return {
    claim: async (limit) => (await run(CLAIM, [limit, options.leaseS])).rows.map(jobOf),
    settle: async (job) => (await run(SETTLE, [job.did, job.lease, job.lock])).rowCount === 1,
    retry: async (job, inS) => (await run(RETRY, [job.did, job.lease, inS])).rowCount === 1,
  };
}
