// The notification inbox's rows (P2.27, ADR 0079 and 0081; migration 0036). Every statement names the member's DID, and every
// read or delete a browser makes names its session too, so an id a form sends never reaches another member's row
// (rule SE-2) and an entry marked `older_sessions_only` stays out of reach of any browser signed in after it was sent.
// The bell's newest few come with the session read instead (infrastructure/session/store.ts), through the same view.
// Each call is one statement on the connection the caller gives, so a source may send inside its own transaction.
import type { Did } from "@unset/domains-identity";
import type { Entry, Notification, NotificationId, Reason } from "@unset/domains-notifications";
import { KEEP_DAYS } from "@unset/domains-notifications";
import type { Db } from "./singleUse/store.ts";

/**
 * The rows this browser may see, through app.inbox (migration 0036), the one place the rule is written: none unless
 * the session is the member's own and still exists; of the rows marked `older_sessions_only` only those sent after
 * this browser's session began. $1 is the DID, $2 the session's id hash.
 */
const VISIBLE_IDS = "SELECT i.id FROM app.inbox i WHERE i.viewer = $2 AND i.did = $1";

const LIST = `SELECT i.id, i.reason, i.topic, i.created_at, i.seen FROM app.inbox i WHERE i.viewer = $2 AND i.did = $1
   ORDER BY i.created_at DESC, i.id LIMIT $3`;

/** The ids a form named ($3, a uuid[]), those this browser may see only. */
const DISMISS = `DELETE FROM app.notification n WHERE n.did = $1 AND n.id = ANY($3::uuid[]) AND n.id IN (${VISIBLE_IDS})
   RETURNING n.id, n.reason, n.topic, n.created_at, false AS seen`;

/** Everything the list showed: `upTo` is its newest entry, so one sent after the list was drawn stays. */
const DISMISS_UP_TO = `DELETE FROM app.notification n WHERE n.did = $1 AND n.id IN (${VISIBLE_IDS})
   AND n.created_at <= (SELECT u.created_at FROM app.notification u WHERE u.id = $3 AND u.did = $1)
   RETURNING n.id, n.reason, n.topic, n.created_at, false AS seen`;

/**
 * The seen marks moved up to `upTo` ($3), an entry this browser may see, and never back: this browser's own (ADR
 * 0085, migration 0039) and the account's (ADR 0090, migration 0041), which counts on every browser of the member for
 * every entry not sent `older_sessions_only` (app.inbox says which mark covers which row). greatest() ignores the
 * null of a mark not set yet (https://www.postgresql.org/docs/18/functions-conditional.html#FUNCTIONS-GREATEST-LEAST).
 * Each sign-in alert this browser may see, up to `upTo`, is marked on its own row (ADR 0108, migration 0043), so it
 * counts as seen everywhere; app.inbox names only alerts sent after this browser's session began, never the one about
 * it. One statement: each row's lock orders two browsers marking at once (rule DA-4), and an id this browser may not
 * see matches no row, so no mark moves.
 */
const MARK_SEEN = `WITH shown AS (
      SELECT i.created_at FROM app.inbox i WHERE i.viewer = $2 AND i.did = $1 AND i.id = $3
    ), this_browser AS (
      UPDATE app.session s SET notifications_seen_at = greatest(s.notifications_seen_at, shown.created_at)
        FROM shown WHERE s.id_hash = $2 AND s.did = $1
    ), alerts AS (
      UPDATE app.notification n SET seen_at = now()
        FROM shown WHERE n.did = $1 AND n.older_sessions_only AND n.seen_at IS NULL
         AND n.created_at <= shown.created_at AND n.id IN (${VISIBLE_IDS})
    )
    UPDATE app.account a SET notifications_seen_at = greatest(a.notifications_seen_at, shown.created_at)
      FROM shown WHERE a.did = $1`;

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

type Row = { id: string; reason: string; topic: string | null; created_at: Date; seen: boolean };

const entryOf = (row: Row): Entry => ({
  id: row.id as NotificationId,
  reason: row.reason as Reason, // the table's CHECK holds the same closed list as REASONS
  topic: row.topic,
  sentAt: row.created_at,
  seen: row.seen,
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
    async dismiss(db: Db, did: Did, idHash: Buffer, ids: readonly NotificationId[]): Promise<Entry[]> {
      if (ids.length === 0) return [];
      const { rows } = await db.query<Row>(DISMISS, [did, idHash, ids]);
      return rows.map(entryOf);
    },
    async dismissUpTo(db: Db, did: Did, idHash: Buffer, upTo: NotificationId): Promise<Entry[]> {
      const { rows } = await db.query<Row>(DISMISS_UP_TO, [did, idHash, upTo]);
      return rows.map(entryOf);
    },
    async markSeen(db: Db, did: Did, idHash: Buffer, upTo: NotificationId): Promise<void> {
      await db.query(MARK_SEEN, [did, idHash, upTo]);
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
