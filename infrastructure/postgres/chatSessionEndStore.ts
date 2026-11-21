// Ending chat when web ends a session (migration 0049; ADR 0095 decision 5, ADR 0096 decision 7). `queueForSession`
// and `queueForDid` run on the caller's transaction, the one that ends the web session, so the chat end commits with
// it and no network I/O runs inside (rule DA-4); web's job then claims, puts back and finishes rows through the
// owner's functions, since web reads no door table. A claim locks due rows with SKIP LOCKED in one statement; a finish
// or retry writes only while its lease holds.
import type { Did } from "@unset/domains-identity";
import { type ChatSessionEndJob, parseChatUser, parseDeviceId, sessionRef } from "@unset/domains-messaging";
import type { Pool } from "./pool.ts";
import { withClient } from "./pool.ts";
import type { Db } from "./singleUse/store.ts";

export type ChatSessionEndStore = {
  /** Log out of one web session (its row's key, the hash of its cookie): the devices it signed in. */
  queueForSession(db: Db, idHash: Uint8Array): Promise<number>;
  /** Every device of `did`, and every session of `did` marked ended: before its sessions are ended. */
  queueForDid(db: Db, did: Did): Promise<number>;
  /**
   * After `queueForDid`: the queued devices this web session signed in wait the Log out grace instead (migration
   * 0051), for the chat page in the browser that signed out everywhere. How many it held.
   */
  holdForSession(db: Db, idHash: Uint8Array): Promise<number>;
  claim(limit: number): Promise<ChatSessionEndJob[]>;
  finish(job: ChatSessionEndJob): Promise<boolean>;
  retry(job: ChatSessionEndJob, inS: number): Promise<boolean>;
};

const QUEUE = "SELECT app.end_chat_sessions($1::text[], $2, $3) AS queued";
const HOLD = "SELECT app.hold_chat_session_end($1, $2) AS held";
const SESSIONS = "SELECT id_hash FROM app.session WHERE did = $1";
const CLAIM = "SELECT chat_user, device_id, attempts, lease FROM app.claim_chat_session_end($1, $2)";
const FINISH = "SELECT app.finish_chat_session_end($1, $2, $3::uuid) AS finished";
const RETRY = `UPDATE app.chat_session_end SET attempts = attempts + 1, due_at = now() + make_interval(secs => $4),
    lease_token = NULL
 WHERE chat_user = $1 AND device_id = $2 AND lease_token = $3::uuid`;

function jobOf(row: Record<string, unknown>): ChatSessionEndJob {
  const user = parseChatUser(row.chat_user);
  const device = parseDeviceId(row.device_id);
  if (user === null || device === null || typeof row.lease !== "string") throw new Error("chat_session_end row");
  return { user, device, attempts: Number(row.attempts), lease: row.lease };
}

export type ChatSessionEndOptions = {
  /** Seconds a claim holds its row, longer than one chat-admin call. */
  readonly leaseS: number;
  /** Seconds after Log out before a session's devices are due (0: at once; ADR 0095 decision 5). */
  readonly logoutAfterS: number;
};

export function createChatSessionEndStore(pool: Pool, options: ChatSessionEndOptions): ChatSessionEndStore {
  const run = async (sql: string, values: unknown[]) =>
    withClient(pool, null, (db) => db.query<Record<string, unknown>>(sql, values));
  const queued = (rows: Record<string, unknown>[]) => Number(rows[0]?.queued ?? 0);
  return {
    async queueForSession(db, idHash) {
      const { rows } = await db.query(QUEUE, [[sessionRef(idHash)], null, options.logoutAfterS]);
      return queued(rows);
    },
    async queueForDid(db, did) {
      const { rows: sessions } = await db.query<{ id_hash: Buffer }>(SESSIONS, [did]);
      const refs = sessions.map((s) => sessionRef(s.id_hash));
      const { rows } = await db.query(QUEUE, [refs, did, 0]);
      return queued(rows);
    },
    async holdForSession(db, idHash) {
      const { rows } = await db.query<{ held: number }>(HOLD, [sessionRef(idHash), options.logoutAfterS]);
      return Number(rows[0]?.held ?? 0);
    },
    claim: async (limit) => (await run(CLAIM, [limit, options.leaseS])).rows.map(jobOf),
    finish: async (job) => (await run(FINISH, [job.user, job.device, job.lease])).rows[0]?.finished === true,
    retry: async (job, inS) => (await run(RETRY, [job.user, job.device, job.lease, inS])).rowCount === 1,
  };
}
