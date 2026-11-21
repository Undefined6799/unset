// door.browser (migration 0043; ADR 0093 decision 4, ADR 0095 decision 4): the door's browser list, for chat_auth.
// Every statement names the browser or the entry's own id and DID, so nothing a request sends reaches another
// browser's row (rule SE-2). The lock key is sealed to its row id (sealed-columns.json), so a dump opens nothing and a
// key moved to another row fails. Each call is one statement; none holds a transaction open (rule DA-4): a concurrent
// first sign-in loses on the unique (browser_hash, did) pair and reads `taken`.

import type { Did } from "@unset/domains-identity";
import {
  type BrowserEntry,
  type BrowserKey,
  type BrowserList,
  type ChatUser,
  type DeviceId,
  LOCK_KEY_BYTES,
  type LockKey,
  parseChatUser,
  parseDeviceId,
} from "@unset/domains-messaging";
import type { Sealer } from "@unset/infrastructure-seal";
import { type Pool, withClient } from "./pool.ts";
import { sealedContext } from "./sealedColumns.ts";

const COLUMNS = "id::text AS id, did, chat_user, device_id, lock_key";
const FIND = `SELECT ${COLUMNS} FROM door.browser WHERE browser_hash = $1 AND did = $2`;
const FIND_DEVICE = `SELECT ${COLUMNS} FROM door.browser WHERE browser_hash = $1 AND device_id = $2`;
const ADD = `INSERT INTO door.browser (id, browser_hash, did, chat_user, web_session, device_id, lock_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (browser_hash, did) DO NOTHING`;
const RENEW = `UPDATE door.browser SET web_session = $4, last_used_at = now()
 WHERE id = $1 AND did = $2 AND device_id = $3`;
const SIGNED_IN_FROM = "SELECT 1 FROM door.browser WHERE id = $1 AND did = $2 AND web_session = $3";
const REMOVE = "DELETE FROM door.browser WHERE id = $1 AND did = $2";
const ANY = "SELECT 1 FROM door.browser WHERE browser_hash = $1 LIMIT 1";

type Row = { id: string; did: string; chat_user: string; device_id: string; lock_key: string };

export function createBrowserListStore(pool: Pool, sealer: Sealer): BrowserList {
  const context = (id: string) => sealedContext("door.browser.lock_key", id);

  /** A stored row as an entry; a row the migration's checks should have refused is a fault, never a partial entry. */
  function entryOf(row: Row): BrowserEntry {
    const user = parseChatUser(row.chat_user);
    const device = parseDeviceId(row.device_id);
    const lockKey = sealer.unseal(row.lock_key, context(row.id));
    if (user === null || device === null || lockKey.byteLength !== LOCK_KEY_BYTES) throw new Error("door.browser row");
    return {
      id: row.id,
      did: row.did as Did,
      user: user as ChatUser,
      device: device as DeviceId,
      lockKey: lockKey as LockKey,
    };
  }

  const one = async (sql: string, values: unknown[], deadline: AbortSignal) => {
    const { rows } = await withClient(pool, deadline, (db) => db.query<Row>(sql, values));
    return rows[0] === undefined ? null : entryOf(rows[0]);
  };
  const hash = (browser: BrowserKey) => Buffer.from(browser);

  return {
    find: (browser, did, deadline) => one(FIND, [hash(browser), did], deadline),
    findDevice: (browser, device, deadline) => one(FIND_DEVICE, [hash(browser), device], deadline),
    async add(browser, entry, sid, deadline) {
      const sealed = sealer.seal(entry.lockKey, context(entry.id));
      const values = [entry.id, hash(browser), entry.did, entry.user, sid, entry.device, sealed];
      const { rowCount } = await withClient(pool, deadline, (db) => db.query(ADD, values));
      return rowCount === 1 ? "added" : "taken";
    },
    async renew(entry, sid, deadline) {
      const values = [entry.id, entry.did, entry.device, sid];
      const { rowCount } = await withClient(pool, deadline, (db) => db.query(RENEW, values));
      return rowCount === 1;
    },
    async signedInFrom(entry, sid, deadline) {
      const values = [entry.id, entry.did, sid];
      const { rowCount } = await withClient(pool, deadline, (db) => db.query(SIGNED_IN_FROM, values));
      return rowCount === 1;
    },
    async remove(entry, deadline) {
      await withClient(pool, deadline, (db) => db.query(REMOVE, [entry.id, entry.did]));
    },
    async holdsAny(browser, deadline) {
      const { rowCount } = await withClient(pool, deadline, (db) => db.query(ANY, [hash(browser)]));
      return rowCount === 1;
    },
  };
}
