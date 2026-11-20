// The notification inbox's rows (P2.27, ADR 0079; migration 0036). Every statement names the member's DID, and every
// read or delete a browser makes names its session too, so an id a form sends never reaches another member's row
// (rule SE-2) and an entry marked `older_sessions_only` stays out of reach of any browser signed in after it was sent.
// Each call is one statement on the connection the caller gives, so a source may send inside its own transaction.
import type { Did } from "@unset/domains-identity";
import type { Entry, Notification, NotificationId, Reason } from "@unset/domains-notifications";
import { KEEP_DAYS } from "@unset/domains-notifications";
import type { Db } from "./singleUse/store.ts";

/**
 * The rows this browser may see: none unless its session is the member's own and still exists; then the member's
 * rows, and of those marked `older_sessions_only` only the ones sent after this browser's session began.
 * $1 is the DID, $2 the session's id hash.
 */
const VIEWER_START = "(SELECT s.created_at FROM app.session s WHERE s.id_hash = $2 AND s.did = $1)";
const VISIBLE =
  `n.did = $1 AND ${VIEWER_START} IS NOT NULL ` + `AND (NOT n.older_sessions_only OR n.created_at > ${VIEWER_START})`;

const LIST = `SELECT n.id, n.reason, n.topic, n.created_at FROM app.notification n WHERE ${VISIBLE}
   ORDER BY n.created_at DESC, n.id LIMIT $3`;

const OPEN = `DELETE FROM app.notification n WHERE n.id = $3 AND ${VISIBLE}
   RETURNING n.id, n.reason, n.topic, n.created_at`;

/** Everything the list showed: `upTo` is its newest entry, so one sent after the list was drawn stays. */
const OPEN_UP_TO = `DELETE FROM app.notification n WHERE ${VISIBLE}
   AND n.created_at <= (SELECT u.created_at FROM app.notification u WHERE u.id = $3 AND u.did = $1)
   RETURNING n.id, n.reason, n.topic, n.created_at`;

/**
 * A member with no account row yet (their first sign-in, before the terms step) has nothing to be told, so the row is
 * not made; ON CONFLICT keeps one row per member and dedupe key.
 */
const INSERT = `INSERT INTO app.notification (did, reason, topic, dedupe_key, older_sessions_only)
  SELECT $1::text, $2::text, $3::text, $4::text, $5::boolean
   WHERE EXISTS (SELECT 1 FROM app.account a WHERE a.did = $1::text)
  ON CONFLICT (did, dedupe_key) DO NOTHING`;

const WITHDRAW = "DELETE FROM app.notification WHERE did = $1 AND dedupe_key = $2";

/**
 * The 30-day ceiling: every member's entries sent more than $1 days ago (KEEP_DAYS), opened or not. No DID predicate
 * because it acts for no member; one fixed, idempotent statement, safe on every replica, like the other sweeps.
 */
const SWEEP = "DELETE FROM app.notification WHERE created_at <= now() - make_interval(days => $1)";

type Row = { id: string; reason: string; topic: string | null; created_at: Date };

const entryOf = (row: Row): Entry => ({
  id: row.id as NotificationId,
  reason: row.reason as Reason, // the table's CHECK holds the same closed list as REASONS
  topic: row.topic,
  sentAt: row.created_at,
});

export function createNotificationStore() {
  return {
    async insert(db: Db, did: Did, n: Notification): Promise<void> {
      await db.query(INSERT, [did, n.reason, n.topic ?? null, n.dedupeKey ?? null, n.olderSessionsOnly ?? false]);
    },
    async list(db: Db, did: Did, idHash: Buffer, limit: number): Promise<Entry[]> {
      const { rows } = await db.query<Row>(LIST, [did, idHash, limit]);
      return rows.map(entryOf);
    },
    async open(db: Db, did: Did, idHash: Buffer, id: NotificationId): Promise<Entry | null> {
      const { rows } = await db.query<Row>(OPEN, [did, idHash, id]);
      return rows[0] === undefined ? null : entryOf(rows[0]);
    },
    async openUpTo(db: Db, did: Did, idHash: Buffer, upTo: NotificationId): Promise<Entry[]> {
      const { rows } = await db.query<Row>(OPEN_UP_TO, [did, idHash, upTo]);
      return rows.map(entryOf);
    },
    /** A source taking back what it sent, by its dedupe key (the banner's dismiss withdraws the notice's entry). */
    async withdraw(db: Db, did: Did, dedupeKey: string): Promise<void> {
      await db.query(WITHDRAW, [did, dedupeKey]);
    },
    /** `keepDays` is KEEP_DAYS in service; a test passes 0, as web may not backdate a row (migration 0036). */
    async sweep(db: Db, keepDays: number = KEEP_DAYS): Promise<number> {
      return (await db.query(SWEEP, [keepDays])).rowCount ?? 0;
    },
  };
}

export type NotificationStore = ReturnType<typeof createNotificationStore>;
