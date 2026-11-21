// door.push (migration 0045; ADR 0094, ADR 0101): the door's pushkeys and the chat count, for chat_auth. A key is
// issued to an entry by its own id (rule SE-2) and replaces that entry's last one in one statement (INSERT ... ON
// CONFLICT DO UPDATE on the primary key; rule DA-4). A number is recorded by the key's hash alone, one statement, the
// last write winning: the homeserver sends each pusher's notifications one at a time
// (synapse/push/httppusher.py `_process`, Synapse 1.165.0). The member's number is read by DID through door.browser.
import type { PushKeys } from "@unset/domains-messaging";
import { type Pool, withClient } from "./pool.ts";

const ISSUE = `INSERT INTO door.push (browser_id, pushkey_hash) VALUES ($1, $2)
  ON CONFLICT (browser_id) DO UPDATE SET pushkey_hash = excluded.pushkey_hash`;
const RECORD = `UPDATE door.push SET unread = coalesce($2, unread),
  counted_at = CASE WHEN $2::integer IS NULL THEN counted_at ELSE now() END
 WHERE pushkey_hash = $1`;
const LATEST = `SELECT p.unread FROM door.push p JOIN door.browser b ON b.id = p.browser_id
 WHERE b.did = $1 AND p.counted_at IS NOT NULL ORDER BY p.counted_at DESC LIMIT 1`;

// Any key on any browser entry of the member (ADR 0095 decision 2: web's onboarding chat step), through the same index.
const REGISTERED = `SELECT EXISTS (SELECT 1 FROM door.push p JOIN door.browser b ON b.id = p.browser_id WHERE b.did = $1)
  AS registered`;

export function createPushKeyStore(pool: Pool): PushKeys {
  return {
    async issue(entry, hash, deadline) {
      await withClient(pool, deadline, (db) => db.query(ISSUE, [entry.id, Buffer.from(hash)]));
    },
    async record(hash, unread, deadline) {
      const { rowCount } = await withClient(pool, deadline, (db) => db.query(RECORD, [Buffer.from(hash), unread]));
      return rowCount === 1;
    },
    async latest(did, deadline) {
      const { rows } = await withClient(pool, deadline, (db) => db.query<{ unread: number }>(LATEST, [did]));
      return rows[0]?.unread ?? null;
    },
    async registered(did, deadline) {
      const { rows } = await withClient(pool, deadline, (db) => db.query<{ registered: boolean }>(REGISTERED, [did]));
      return rows[0]?.registered === true;
    },
  };
}
