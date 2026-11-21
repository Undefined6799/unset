// app.chat_account (migration 0042; ADR 0010, ADR 0093 decision 3): the DID to chat user mapping and the queued
// "create chat account" job it carries, for web. `request` runs on the terms transaction, so the job exists exactly
// when the acceptance does (rule DA-2). A claim is one statement that locks due rows with SKIP LOCKED and gives each a
// fresh lease; a settle writes only while that lease holds (rule DA-4). Every statement names the caller's DID.
import type { Did } from "@unset/domains-identity";
import { type ChatAccountJob, type ChatUser, type JobSettlement, parseChatUser } from "@unset/domains-messaging";
import type { Pool, PoolClient } from "./pool.ts";
import { withClient } from "./pool.ts";

export type ChatAccountStore = {
  /** Queues the member's chat account on `tx`; a second call keeps the chat user drawn first (ids never change). */
  request(tx: PoolClient, did: Did): Promise<void>;
  claim(limit: number): Promise<ChatAccountJob[]>;
  settle(job: ChatAccountJob, settlement: JobSettlement): Promise<boolean>;
  /** The member's chat user once chat-admin has created it and while it is not locked, else null. */
  readyUser(did: Did, deadline: AbortSignal): Promise<ChatUser | null>;
};

export type ChatAccountStoreOptions = {
  /** Draws a new chat user (domains/messaging newChatUser on the CSPRNG; the composition root passes it). */
  readonly newUser: () => ChatUser;
  /** Seconds a claim holds its job: longer than the handle check and chat-admin call together. */
  readonly leaseS: number;
};

// A unique violation on chat_user (two draws of 100 random bits meeting) fails the terms transaction, which the
// member sends again; it is never resolved by drawing silently inside a statement.
const REQUEST = "INSERT INTO app.chat_account (did, chat_user) VALUES ($1, $2) ON CONFLICT (did) DO NOTHING";

const CLAIM = `UPDATE app.chat_account c SET due_at = now() + make_interval(secs => $2), lease_token = gen_random_uuid(),
    updated_at = now()
  FROM (SELECT did FROM app.chat_account WHERE state = 'pending' AND due_at <= now()
         ORDER BY due_at, did LIMIT $1 FOR UPDATE SKIP LOCKED) due
 WHERE c.did = due.did
 RETURNING c.did, c.chat_user, c.attempts, c.lease_token::text AS lease`;

const SETTLE = `UPDATE app.chat_account SET state = $3, attempts = attempts + $4,
    due_at = now() + make_interval(secs => $5), lease_token = NULL, updated_at = now()
 WHERE did = $1 AND lease_token = $2::uuid AND state = 'pending'`;

// A locked account gets no new ticket (ADR 0096 decision 1); chat-admin refuses its mint as well.
const READY = "SELECT chat_user FROM app.chat_account WHERE did = $1 AND state = 'ready' AND NOT locked";

function jobOf(row: Record<string, unknown>): ChatAccountJob {
  const user = parseChatUser(row.chat_user);
  if (user === null || typeof row.lease !== "string") throw new Error("chat_account row");
  return { did: row.did as Did, user, attempts: Number(row.attempts), lease: row.lease };
}

export function createChatAccountStore(pool: Pool, options: ChatAccountStoreOptions): ChatAccountStore {
  return {
    async request(tx, did) {
      await tx.query(REQUEST, [did, options.newUser()]);
    },
    async claim(limit) {
      const { rows } = await withClient(pool, null, (db) =>
        db.query<Record<string, unknown>>(CLAIM, [limit, options.leaseS]),
      );
      return rows.map(jobOf);
    },
    async settle(job, settlement) {
      // Every outcome but ready is one more failed attempt; only a retry waits.
      const failedAttempt = settlement.state === "ready" ? 0 : 1;
      const waitS = settlement.state === "pending" ? settlement.retryInS : 0;
      const values = [job.did, job.lease, settlement.state, failedAttempt, waitS];
      const { rowCount } = await withClient(pool, null, (db) => db.query(SETTLE, values));
      return rowCount === 1;
    },
    async readyUser(did, deadline) {
      const { rows } = await withClient(pool, deadline, (db) => db.query<Record<string, unknown>>(READY, [did]));
      return rows[0] === undefined ? null : parseChatUser(rows[0].chat_user);
    },
  };
}
