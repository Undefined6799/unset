// app.chat_erasure (migrations 0042 and 0047; ADR 0096 decision 3): the chat users of erased members, which web drains
// through chat-admin's deactivate. core.erase_did alone adds rows, as their owner; web only claims, deletes and puts
// back. A claim also reads how long ago the row was queued (migration 0049's grant), so a creation still in flight
// when the member was erased is waited for (domains/messaging CREATE_LANDS_WITHIN_S). A claim is one statement that locks due rows with SKIP LOCKED and gives each a fresh lease; a finish or retry
// writes only while that lease holds (rule DA-4). The rows hold no DID, so there is no DID predicate to add.
import { type ChatErasureJob, parseChatUser } from "@unset/domains-messaging";
import type { Pool } from "./pool.ts";
import { withClient } from "./pool.ts";

export type ChatErasureStore = {
  claim(limit: number): Promise<ChatErasureJob[]>;
  finish(job: ChatErasureJob): Promise<boolean>;
  retry(job: ChatErasureJob, inS: number): Promise<boolean>;
};

const CLAIM = `UPDATE app.chat_erasure e SET due_at = now() + make_interval(secs => $2), lease_token = gen_random_uuid()
  FROM (SELECT chat_user FROM app.chat_erasure WHERE due_at <= now()
         ORDER BY due_at, chat_user LIMIT $1 FOR UPDATE SKIP LOCKED) due
 WHERE e.chat_user = due.chat_user
 RETURNING e.chat_user, e.attempts, e.lease_token::text AS lease,
    floor(extract(epoch FROM now() - e.queued_at))::int AS queued_for_s`;

const FINISH = "DELETE FROM app.chat_erasure WHERE chat_user = $1 AND lease_token = $2::uuid";

const RETRY = `UPDATE app.chat_erasure SET attempts = attempts + 1, due_at = now() + make_interval(secs => $3),
    lease_token = NULL
 WHERE chat_user = $1 AND lease_token = $2::uuid`;

function jobOf(row: Record<string, unknown>): ChatErasureJob {
  const user = parseChatUser(row.chat_user);
  if (user === null || typeof row.lease !== "string" || typeof row.queued_for_s !== "number") {
    throw new Error("chat_erasure row");
  }
  return { user, attempts: Number(row.attempts), lease: row.lease, queuedForS: row.queued_for_s };
}

/** `leaseS`: seconds a claim holds its row, longer than one chat-admin call. */
export function createChatErasureStore(pool: Pool, options: { readonly leaseS: number }): ChatErasureStore {
  const run = async (sql: string, values: unknown[]) =>
    withClient(pool, null, (db) => db.query<Record<string, unknown>>(sql, values));
  return {
    claim: async (limit) => (await run(CLAIM, [limit, options.leaseS])).rows.map(jobOf),
    finish: async (job) => (await run(FINISH, [job.user, job.lease])).rowCount === 1,
    retry: async (job, inS) => (await run(RETRY, [job.user, job.lease, inS])).rowCount === 1,
  };
}
