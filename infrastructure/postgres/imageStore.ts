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

/** An image's pixel size, and whether the call made the record's use (false when the record already had it). */
/** A use a save asked for: the image's size, whether the call made it, and the lease it holds on it now. */
export type ImageUse = {
  readonly width: number;
  readonly height: number;
  readonly created: boolean;
  readonly lease: string;
};

/** A use this request made, by the lease it got: taken back only while nothing else has touched it. */
export type HeldUse = { readonly id: string; readonly lease: string };

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

/** Images of the member's with no use left start their 7 days before their copies go. */
async function markUnused(tx: PoolClient, did: Did, ids: readonly string[]): Promise<void> {
  await tx.query(
    `UPDATE app.image SET unused_since = now()
      WHERE did = $1 AND id = ANY($2::uuid[])
        AND NOT EXISTS (SELECT 1 FROM app.image_use u WHERE u.image_id = app.image.id)`,
    [did, ids],
  );
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

    /**
     * A save's record uses the image, once however often it is asked; its pixel size, which the record's aspect ratio
     * gives, or null when it is not the member's, gone, held or blocked. Every call takes a new lease on the use, so
     * a save that made it can tell, when it takes it back, whether another save has asked for it since (removeUse).
     */
    addUse: (did: Did, id: string, recordUri: string, deadline: AbortSignal | null): Promise<ImageUse | null> =>
      withTransaction(pool, deadline, async (tx) => {
        if (!ownRecord(did, recordUri) || !(await lockImage(tx, did, id))) return null;
        const { rows } = await tx.query<{ width: number; height: number }>(
          `UPDATE app.image SET state = 'published', unused_since = NULL
            WHERE id = $1 AND did = $2 AND state IN ('uploaded', 'released', 'published')
            RETURNING width, height`,
          [id, did],
        );
        const [size] = rows;
        if (size === undefined) return null;
        const inserted = await tx.query<{ lease: string }>(
          `INSERT INTO app.image_use (image_id, record_uri) VALUES ($1, $2) ON CONFLICT DO NOTHING
            RETURNING lease::text AS lease`,
          [id, recordUri],
        );
        const made = inserted.rows[0];
        const lease =
          made ??
          (
            await tx.query<{ lease: string }>(
              `UPDATE app.image_use SET lease = gen_random_uuid() WHERE image_id = $1 AND record_uri = $2
                RETURNING lease::text AS lease`,
              [id, recordUri],
            )
          ).rows[0];
        if (lease === undefined) throw new Error("image_use row vanished under its image lock");
        return {
          width: Number(size.width),
          height: Number(size.height),
          created: made !== undefined,
          lease: lease.lease,
        };
      }),

    /**
     * Takes back a use a save made, whose write surely did not land, only while it still holds `lease` and no write
     * has settled it: a save or write since may rely on it. When no use is left its copies go 7 days later.
     */
    removeUse: (did: Did, id: string, recordUri: string, lease: string, deadline: AbortSignal | null): Promise<void> =>
      withTransaction(pool, deadline, async (tx) => {
        if (!(await lockImage(tx, did, id))) return;
        const { rowCount } = await tx.query(
          `DELETE FROM app.image_use u USING app.image i
            WHERE u.image_id = i.id AND i.id = $1 AND i.did = $2 AND u.record_uri = $3
              AND u.lease = $4::uuid AND u.settled_rev IS NULL`,
          [id, did, recordUri, lease],
        );
        if ((rowCount ?? 0) === 0) return;
        await markUnused(tx, did, [id]);
      }),

    /** Notes the CID the member's PDS gave the image's main version, by which a settled write names it. */
    notePublished: (did: Did, id: string, blobCid: string, deadline: AbortSignal | null): Promise<void> =>
      withClient(pool, deadline, async (client) => {
        await client.query("UPDATE app.image SET blob_cid = $3 WHERE id = $1 AND did = $2", [id, did, blobCid]);
      }),

    /**
     * A write of the record landed as commit `rev`, showing the member's image published as `shownCid` (null: no
     * picture). Writes of one record are settled one at a time, in revision order (a TID sorts by time;
     * https://atproto.com/specs/tid): one older than a revision the record's uses already hold changes nothing but
     * takes back the uses it made (`mine`). A newer one leaves the record exactly the shown image's use, stamped with
     * its revision, and takes back older settled uses and its own; uses other saves still have in flight stay (their
     * own write settles them). An image left with no use has its copies deleted 7 days later.
     */
    settleUse: (
      did: Did,
      recordUri: string,
      rev: string,
      shownCid: string | null,
      mine: readonly HeldUse[],
      deadline: AbortSignal | null,
    ): Promise<void> =>
      withTransaction(pool, deadline, async (tx) => {
        if (!ownRecord(did, recordUri)) return;
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('image_use:' || $1::text))", [recordUri]);
        const ids = mine.map((use) => use.id);
        const leases = mine.map((use) => use.lease);
        const uses = await tx.query<{ id: string; settled: string | null; mine: boolean }>(
          `SELECT u.image_id::text AS id, u.settled_rev AS settled,
                  (u.image_id, u.lease) IN (SELECT * FROM unnest($3::uuid[], $4::uuid[])) AS mine
             FROM app.image_use u JOIN app.image i ON i.id = u.image_id
            WHERE i.did = $1 AND u.record_uri = $2
            ORDER BY u.image_id FOR UPDATE OF i`,
          [did, recordUri, ids, leases],
        );
        const shown =
          shownCid === null
            ? []
            : (
                await tx.query<{ id: string }>(
                  "SELECT id::text AS id FROM app.image WHERE did = $1 AND blob_cid = $2 ORDER BY id",
                  [did, shownCid],
                )
              ).rows.map((row) => row.id);
        const newer = uses.rows.some((use) => use.settled !== null && use.settled >= rev);
        const gone = uses.rows
          .filter((use) =>
            newer
              ? use.mine && use.settled === null
              : !shown.includes(use.id) && (use.mine ? use.settled === null : use.settled !== null),
          )
          .map((use) => use.id);
        if (gone.length > 0) {
          await tx.query("DELETE FROM app.image_use WHERE record_uri = $1 AND image_id = ANY($2::uuid[])", [
            recordUri,
            gone,
          ]);
          await markUnused(tx, did, gone);
        }
        if (newer || shown.length === 0) return;
        const kept = uses.rows.filter((use) => shown.includes(use.id)).map((use) => use.id);
        const target = kept.length > 0 ? kept : [ids.find((id) => shown.includes(id)) ?? (shown[0] as string)];
        for (const id of target) {
          await tx.query(
            `INSERT INTO app.image_use (image_id, record_uri, settled_rev) VALUES ($1, $2, $3)
             ON CONFLICT (image_id, record_uri) DO UPDATE SET settled_rev = $3, lease = gen_random_uuid()`,
            [id, recordUri, rev],
          );
          // A held or blocked image keeps its state; only a live one is published again (as addUse does).
          await tx.query(
            `UPDATE app.image SET state = 'published', unused_since = NULL
              WHERE id = $1 AND did = $2 AND state IN ('uploaded', 'released', 'published')`,
            [id, did],
          );
        }
      }),

    /**
     * The record is gone: its uses go, and an image left with no use has its copies deleted 7 days later. Each image
     * is locked as removeUse locks it.
     */
    dropUses: (did: Did, recordUri: string, deadline: AbortSignal | null): Promise<void> =>
      withTransaction(pool, deadline, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('image_use:' || $1::text))", [recordUri]);
        const { rows } = await tx.query<{ id: string }>(
          `SELECT i.id::text AS id FROM app.image i JOIN app.image_use u ON u.image_id = i.id
            WHERE i.did = $1 AND u.record_uri = $2
            ORDER BY i.id FOR UPDATE OF i`,
          [did, recordUri],
        );
        const ids = rows.map((row) => row.id);
        if (ids.length === 0) return;
        await tx.query("DELETE FROM app.image_use WHERE record_uri = $1 AND image_id = ANY($2::uuid[])", [
          recordUri,
          ids,
        ]);
        await markUnused(tx, did, ids);
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
  };
}

export type ImageStore = ReturnType<typeof createImageStore>;
