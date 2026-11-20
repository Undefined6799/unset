// A member's image library (ADR 0070 points 4 and 6; migration 0035): the rows behind the upload route's limits and
// quota, the uses a save records, and the expiry sweep. Every member statement carries the caller's DID, so no id a
// form sends reaches another member's image (rule SE-2), and a use's record URI must be in the caller's repository.
//
// Concurrency (rule DA-4): admission and storing each run in one transaction under a per-member advisory lock, so two
// uploads at once cannot both pass the limits or the quota. Adding, removing and discarding first lock the image row
// (lockImage), so they run one at a time per image and each decides on the uses committed before it. The sweep locks
// the rows it deletes with SKIP LOCKED, so it passes over an image a use is changing, and a use that waits for a
// sweep finds the image gone. No network I/O runs inside.
import { randomUUID } from "node:crypto";
import {
  admitUpload,
  fitsQuota,
  IMAGE_EXPIRY,
  type ImageAdmission,
  sweepAllowed,
  type UploadUsage,
} from "@unset/domains-content";
import type { Did } from "@unset/domains-identity";
import { type Pool, type PoolClient, withClient } from "./pool.ts";
import { withTransaction } from "./tx.ts";

export type ImageKind = "image" | "avatar";

export type StoredImage = {
  readonly id: string;
  readonly kind: ImageKind;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
};

export type LibraryImage = StoredImage & { readonly state: string; readonly createdAt: Date; readonly inUse: boolean };

export type SweepResult =
  | { readonly kind: "deleted"; readonly images: readonly { readonly did: Did; readonly id: string }[] }
  | { readonly kind: "refused"; readonly due: number; readonly live: number };

const NEVER_USED = `make_interval(secs => ${IMAGE_EXPIRY.neverUsedMs / 1000})`;
const UNUSED_COPY = `make_interval(secs => ${IMAGE_EXPIRY.unusedCopyMs / 1000})`;

/** Images no save has used past their day, and published images whose last use went a week ago. */
const DUE = `
  ((state IN ('uploaded', 'released') AND created_at <= now() - ${NEVER_USED})
   OR (state = 'published' AND unused_since <= now() - ${UNUSED_COPY}))
  AND NOT EXISTS (SELECT 1 FROM app.image_use u WHERE u.image_id = app.image.id)`;

/** The ledger's last hour and day, and every image row's bytes: each counts for the quota until it is deleted. */
const USAGE = `
  SELECT (SELECT count(*) FROM app.image_upload WHERE did = $1 AND admitted_at > now() - interval '1 hour')::int
           AS last_hour,
         (SELECT count(*) FROM app.image_upload WHERE did = $1 AND admitted_at > now() - interval '1 day')::int
           AS last_day,
         (SELECT coalesce(sum(bytes), 0) FROM app.image WHERE did = $1)::bigint AS live_bytes,
         (SELECT storage_quota_bytes FROM app.account WHERE did = $1) AS quota_bytes`;

const LOCK = "SELECT pg_advisory_xact_lock(hashtext('image:' || $1))";

/**
 * The member's image row, locked for the rest of the transaction. Taken before any statement that decides on the
 * image's uses: under READ COMMITTED each later statement then sees every use committed before the lock was granted,
 * and no other use change can start until this transaction ends. False when the row is gone or not the member's.
 */
async function lockImage(tx: PoolClient, did: Did, id: string): Promise<boolean> {
  const { rowCount } = await tx.query("SELECT 1 FROM app.image WHERE id = $1 AND did = $2 FOR UPDATE", [id, did]);
  return (rowCount ?? 0) > 0;
}

type UsageRow = { last_hour: number; last_day: number; live_bytes: string; quota_bytes: string | null };

const usageOf = (row: UsageRow): UploadUsage => ({
  lastHour: row.last_hour,
  lastDay: row.last_day,
  liveBytes: Number(row.live_bytes),
  quotaBytes: row.quota_bytes === null ? null : Number(row.quota_bytes),
});

/** A record in the member's own repository: `at://<did>/<collection>/<rkey>`. */
const ownRecord = (did: Did, uri: string) => uri.startsWith(`at://${did}/`) && uri.split("/").length === 5;

export function createImageStore(pool: Pool) {
  return {
    /** Before the body is read: checks the limits and the quota and, when they pass, counts the upload. */
    admit: (did: Did, deadline: AbortSignal | null): Promise<ImageAdmission> =>
      withTransaction(pool, deadline, async (tx) => {
        await tx.query(LOCK, [did]);
        const { rows } = await tx.query<UsageRow>(USAGE, [did]);
        const admission = admitUpload(usageOf(rows[0] as UsageRow));
        if (admission.ok) await tx.query("INSERT INTO app.image_upload (did, admitted_at) VALUES ($1, now())", [did]);
        return admission;
      }),

    /** Once the versions are written: the row, if the total still fits the quota. A new id each time. */
    store: (
      did: Did,
      image: Omit<StoredImage, "id">,
      deadline: AbortSignal | null,
    ): Promise<{ ok: true; id: string } | { ok: false; code: "image.quota" }> =>
      withTransaction(pool, deadline, async (tx) => {
        await tx.query(LOCK, [did]);
        const { rows } = await tx.query<UsageRow>(USAGE, [did]);
        const usage = usageOf(rows[0] as UsageRow);
        if (!fitsQuota(usage.liveBytes, image.bytes, usage.quotaBytes)) return { ok: false, code: "image.quota" };
        const id = randomUUID();
        await tx.query(
          `INSERT INTO app.image (id, did, kind, state, width, height, bytes, created_at)
           VALUES ($1, $2, $3, 'uploaded', $4, $5, $6, now())`,
          [id, did, image.kind, image.width, image.height, image.bytes],
        );
        return { ok: true, id };
      }),

    /** A failed upload or a picture removed before any save used it; an image in use is kept. */
    discard: (did: Did, id: string, deadline: AbortSignal | null): Promise<boolean> =>
      withTransaction(pool, deadline, async (tx) => {
        if (!(await lockImage(tx, did, id))) return false;
        const { rowCount } = await tx.query(
          `DELETE FROM app.image WHERE id = $1 AND did = $2
             AND NOT EXISTS (SELECT 1 FROM app.image_use u WHERE u.image_id = app.image.id)`,
          [id, did],
        );
        return (rowCount ?? 0) > 0;
      }),

    /** A save's record uses the image; false when it is not the member's, gone, held or blocked. */
    addUse: (did: Did, id: string, recordUri: string, deadline: AbortSignal | null): Promise<boolean> =>
      withTransaction(pool, deadline, async (tx) => {
        if (!ownRecord(did, recordUri) || !(await lockImage(tx, did, id))) return false;
        const { rowCount } = await tx.query(
          `UPDATE app.image SET state = 'published', unused_since = NULL
            WHERE id = $1 AND did = $2 AND state IN ('uploaded', 'released', 'published')`,
          [id, did],
        );
        if ((rowCount ?? 0) === 0) return false;
        await tx.query("INSERT INTO app.image_use (image_id, record_uri) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
          id,
          recordUri,
        ]);
        return true;
      }),

    /** A save dropped the image from the record; when no use is left its copies go 7 days later. */
    removeUse: (did: Did, id: string, recordUri: string, deadline: AbortSignal | null): Promise<void> =>
      withTransaction(pool, deadline, async (tx) => {
        if (!(await lockImage(tx, did, id))) return;
        const { rowCount } = await tx.query(
          `DELETE FROM app.image_use u USING app.image i
            WHERE u.image_id = i.id AND i.id = $1 AND i.did = $2 AND u.record_uri = $3`,
          [id, did, recordUri],
        );
        if ((rowCount ?? 0) === 0) return;
        await tx.query(
          `UPDATE app.image SET unused_since = now()
            WHERE id = $1 AND did = $2 AND NOT EXISTS (SELECT 1 FROM app.image_use u WHERE u.image_id = $1)`,
          [id, did],
        );
      }),

    /** The member's images, newest first, for the editor's picker and, later, export. */
    list: (did: Did, deadline: AbortSignal | null): Promise<LibraryImage[]> =>
      withClient(pool, deadline, async (client) => {
        const { rows } = await client.query(
          `SELECT id, kind, state, width, height, bytes, created_at,
                  EXISTS (SELECT 1 FROM app.image_use u WHERE u.image_id = app.image.id) AS in_use
             FROM app.image WHERE did = $1 ORDER BY created_at DESC, id`,
          [did],
        );
        return rows.map((row) => ({
          id: String(row.id),
          kind: row.kind as ImageKind,
          state: String(row.state),
          width: Number(row.width),
          height: Number(row.height),
          bytes: Number(row.bytes),
          createdAt: row.created_at as Date,
          inUse: Boolean(row.in_use),
        }));
      }),

    /**
     * Every member's expired images, all or nothing under the governor; the upload ledger's day-old rows go too. It
     * acts for no member, so it has no DID predicate; it returns what it deleted so their objects can follow.
     */
    sweep: (deadline: AbortSignal | null): Promise<SweepResult> =>
      withTransaction(pool, deadline, async (tx) => {
        await tx.query("DELETE FROM app.image_upload WHERE admitted_at <= now() - interval '1 day'");
        const { rows } = await tx.query<{ due: number; live: number }>(
          `SELECT count(*) FILTER (WHERE ${DUE})::int AS due, count(*)::int AS live FROM app.image`,
        );
        const { due, live } = rows[0] as { due: number; live: number };
        if (!sweepAllowed(due, live)) return { kind: "refused", due, live };
        // Capped as well, so rows that fell due after the count still keep the run within the governor; a row a use
        // is locking is skipped and its condition re-checked on a later run.
        const deleted = await tx.query<{ did: Did; id: string }>(
          `DELETE FROM app.image WHERE ${DUE}
              AND id IN (SELECT id FROM app.image WHERE ${DUE} LIMIT $1 FOR UPDATE SKIP LOCKED)
           RETURNING did, id`,
          [due],
        );
        return { kind: "deleted", images: deleted.rows.map((row) => ({ did: row.did, id: String(row.id) })) };
      }),

    /**
     * Which of these ids still have a row, with their member, and how many rows there are in all: the orphan sweep's
     * read (interfaces/web image-orphans.ts). Like the sweep it acts for no member, so it has no DID predicate; the
     * caller matches each row's DID to its folder's.
     */
    named: (
      ids: readonly string[],
      deadline: AbortSignal | null,
    ): Promise<{ live: number; images: { did: Did; id: string }[] }> =>
      withClient(pool, deadline, async (client) => {
        const { rows } = await client.query<{ did: Did; id: string; live: number }>(
          `SELECT i.did, i.id::text AS id, (SELECT count(*) FROM app.image)::int AS live
             FROM (SELECT 1) one LEFT JOIN app.image i ON i.id = ANY($1::uuid[])`,
          [ids],
        );
        const live = rows[0]?.live ?? 0;
        const images = rows.filter((row) => row.id !== null).map((row) => ({ did: row.did, id: String(row.id) }));
        return { live, images };
      }),
  };
}

export type ImageStore = ReturnType<typeof createImageStore>;
