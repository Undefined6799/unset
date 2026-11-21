// The index's writer for the reader of our PDS's stream (book P3.05s; ADRs 0052, 0058). Each frame is applied in one
// transaction as `indexer`, with no network I/O inside it (rule DA-4), and the stream's cursor is written in that same
// transaction, so a frame is applied exactly when the cursor moves past it (ADR 0052 decision 4). Concurrency: one
// reader writes, and the cursor row and the account row are both taken FOR UPDATE, so a second reader started by
// mistake waits rather than interleaving.
//
// What a commit does is decided by domains/profile's planCommit; this file only runs the plan. Every statement is
// parameterised and names the DID of the frame it applies, except missedEvents, which queues every tracked account.
// Nothing here logs: the counters in idx.ingest_stat carry no DID (rule SE-7).
import {
  type BlobRef,
  type IndexAccount,
  type IndexChange,
  type IndexWrite,
  MAX_PAGE_BYTES,
  MAX_SECTIONS_PER_ACCOUNT,
  planCommit,
} from "@unset/domains-profile";
import { AppError } from "@unset/shared-errors";
import { type Pool, type PoolClient, withClient } from "./pool.ts";
import { withTransaction } from "./tx.ts";

/** The frames the index applies. */
export type IndexFrame =
  | {
      readonly kind: "repoCommit";
      readonly seq: number;
      readonly did: string;
      readonly rev: string | null;
      readonly changes: readonly IndexChange[];
    }
  | { readonly kind: "identity"; readonly seq: number; readonly did: string }
  | { readonly kind: "sync"; readonly seq: number; readonly did: string }
  /** The PDS's own account status (https://atproto.com/specs/account, "Account Status"); null when it sent none. */
  | {
      readonly kind: "account";
      readonly seq: number;
      readonly did: string;
      readonly active: boolean;
      readonly status: string | null;
    };

/** What the health board shows of the index: counts only, never a DID, handle or record (rule SE-7). */
export type IndexHealth = {
  readonly cursor: number | null;
  readonly counters: Readonly<Record<Counter, number>>;
  readonly deadLetters: number;
  /** Accounts whose deletion our PDS confirmed and that still wait, hidden, for erasure (P3.06s dead letters). */
  readonly deletionsNotErased: number;
  /**
   * Per job kind, in whole seconds: how long the oldest due job has waited for a pass (a pass falling behind), and how
   * long the oldest job that has failed at least once has been queued (our PDS or a check failing for that long). Null
   * when there is none. For an outside alert; they do not make health unhealthy.
   */
  readonly jobs: Readonly<
    Record<string, { readonly oldestDueS: number | null; readonly oldestFailingS: number | null }>
  >;
};

export type IndexStore = {
  /** The last sequence number applied from this source, or null before the first. */
  readonly cursor: () => Promise<number | null>;
  readonly apply: (frame: IndexFrame) => Promise<void>;
  /**
   * Events may have been missed: every tracked account is queued for a backfill and a status confirmation, since the
   * lost events may have changed either. Repeating it changes nothing.
   */
  readonly missedEvents: () => Promise<void>;
  /**
   * Gives up on a frame that kept failing: records it in idx.dead_letter, queues its account for a backfill (which
   * recovers whatever the frame held) and moves the cursor past it, in one transaction. Never for an account frame.
   */
  readonly deadLetter: (frame: IndexFrame, attempts: number, firstSeen: Date) => Promise<void>;
  readonly health: () => Promise<IndexHealth>;
};

export type IndexStoreOptions = {
  /** The stream's name in idx.relay_cursor, such as "pds". */
  readonly source: string;
  /** Each transaction's deadline (rule RE-1). */
  readonly timeoutMs: number;
};

/** The counters this writer keeps in idx.ingest_stat, for the health board. */
export const INGEST_COUNTERS = [
  "ingest_replayed",
  "ingest_erased",
  "ingest_untracked",
  "ingest_stale",
  "ingest_unsigned",
  "ingest_inactive",
  "ingest_invalid",
  "ingest_capped",
  "ingest_over_budget",
  "ingest_account_inactive",
  "ingest_account_confirm",
  "ingest_dead_letter",
  "track_added",
  "track_erased",
  "track_foreign",
  "track_unresolved",
  "backfill_applied",
  "backfill_skipped",
  "backfill_stale",
  "backfill_failed",
  "backfill_dead_letter",
  "account_confirmed_active",
  "account_confirmed_inactive",
  "account_deletion_erased",
  "account_erase_capped",
  "account_deletion_not_confirmed",
  "account_job_skipped",
  "account_job_superseded",
  "account_job_failed",
  "account_job_dead_letter",
  "handle_verified",
  "handle_invalid",
  "handle_unresolved",
  "handle_moved",
  "handle_unclaimed",
  "handle_outage_lapsed",
] as const;
export type Counter = (typeof INGEST_COUNTERS)[number];

export function createIndexStore(pool: Pool, options: IndexStoreOptions): IndexStore {
  const inTx = <T>(fn: (tx: PoolClient) => Promise<T>) =>
    withTransaction(pool, AbortSignal.timeout(options.timeoutMs), fn);
  return {
    cursor: () =>
      withClient(pool, AbortSignal.timeout(options.timeoutMs), async (client) => {
        const { rows } = await client.query("SELECT seq FROM idx.relay_cursor WHERE source = $1", [options.source]);
        return rows[0] === undefined ? null : Number(rows[0].seq);
      }),
    apply: (frame) => inTx((tx) => applyFrame(tx, options.source, frame)),
    missedEvents: () =>
      inTx(async (tx) => {
        // Like queueJob, a job already queued becomes due now, which also breaks the claim of a read in flight: its
        // snapshot may predate the lost events. A lost #account event (a deactivation, a deletion, a reactivation) is
        // recovered by confirm_status, the same job a live active status queues: a backfill alone never changes whether
        // an account is shown. Rows are taken in DID order, and within a DID confirm_status before backfill, the order
        // every path that touches both takes them in (trackOne, backfillFailed, confirmStatus), so none can deadlock.
        await tx.query(
          `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
           SELECT a.did, k.kind, now(), 0, now() FROM idx.account a
             CROSS JOIN (VALUES (1, 'confirm_status'), (2, 'backfill')) AS k(ord, kind) ORDER BY a.did, k.ord
           ON CONFLICT (did, kind) DO UPDATE SET due_at = LEAST(idx.account_job.due_at, excluded.due_at)`,
        );
      }),
    deadLetter: (frame, attempts, firstSeen) => {
      if (frame.kind === "account") throw new TypeError("an account frame is never dead-lettered");
      return inTx((tx) => deadLetterFrame(tx, options.source, frame, attempts, firstSeen));
    },
    health: () =>
      withClient(pool, AbortSignal.timeout(options.timeoutMs), (client) => readHealth(client, options.source)),
  };
}

/**
 * Whether a failed apply says nothing about the frame: the database could not be reached or answered in time, or the
 * transaction lost a race (book P3.05 error classes, `db_unavailable`). Such a failure is retried without counting
 * it towards the dead letter. Anything else, a statement timeout on this frame included, counts.
 * SQLSTATE classes: postgresql.org/docs/current/errcodes-appendix.html.
 */
export function isDatabaseUnavailable(failure: unknown): boolean {
  // inTransaction throws a failed operation and its failed rollback together, the operation's error first (tx.ts).
  const error: unknown = failure instanceof AggregateError ? failure.errors[0] : failure;
  if (error instanceof AppError) return error.code === "db.busy" || error.code === "http.deadline";
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== "string") return false;
  if (code === "57014") return false; // query_canceled: this frame's own statement ran out of time
  return /^(08|40|53|57)/.test(code) || /^E[A-Z]+$/.test(code); // connection, rollback, resources, shutdown; errno
}

async function deadLetterFrame(tx: PoolClient, source: string, frame: IndexFrame, attempts: number, firstSeen: Date) {
  const cursor = await tx.query("SELECT seq FROM idx.relay_cursor WHERE source = $1 FOR UPDATE", [source]);
  if (cursor.rows[0] !== undefined && frame.seq <= Number(cursor.rows[0].seq)) return;
  // The DID is kept only for a member the index tracks and erasure has not removed: a row for an erased DID would
  // name the person again after core.erase_did deleted theirs, and a non-member's DID is not ours to keep. The reason
  // is a fixed code, since the error itself may quote member content (rule SE-7).
  const tracked = (await isErased(tx, frame.did)) ? null : await lockAccount(tx, frame.did);
  const did = tracked === null ? null : frame.did;
  await tx.query(
    `INSERT INTO idx.dead_letter (kind, did, reason_code, attempts, first_seen, last_seen)
     VALUES ('event', $1, 'apply_failed', $2, $3, now())`,
    [did, attempts, firstSeen],
  );
  if (did !== null) await queueJob(tx, did, "backfill");
  await count(tx, "ingest_dead_letter");
  await writeCursor(tx, source, frame.seq);
}

async function readHealth(client: PoolClient, source: string): Promise<IndexHealth> {
  const cursor = await client.query("SELECT seq FROM idx.relay_cursor WHERE source = $1", [source]);
  const stats = await client.query("SELECT name, value FROM idx.ingest_stat WHERE name = ANY($1::text[])", [
    [...INGEST_COUNTERS],
  ]);
  const dead = await client.query(
    // A P3.06s deletion dead letter counts only while its account is still held as deleted: once our PDS denies the
    // deletion, the account no longer waits for erasure (the dead letter is append-only for indexer).
    `SELECT count(*) AS n,
            count(DISTINCT d.did) FILTER (WHERE d.reason_code = 'deletion_confirmed_not_erased' AND EXISTS (
              SELECT 1 FROM idx.account a WHERE a.did = d.did AND a.pds_status = 'deleted' AND NOT a.pds_active)) AS unerased
     FROM idx.dead_letter d`,
  );
  const jobs = await client.query(
    `SELECT kind,
            floor(extract(epoch FROM now() - min(due_at) FILTER (WHERE due_at <= now()))) AS oldest_due,
            floor(extract(epoch FROM now() - min(first_queued_at) FILTER (WHERE attempts > 0))) AS oldest_failing
     FROM idx.account_job GROUP BY kind ORDER BY kind`,
  );
  const counters = Object.fromEntries(INGEST_COUNTERS.map((name) => [name, 0])) as Record<Counter, number>;
  for (const row of stats.rows) counters[row.name as Counter] = Number(row.value);
  return {
    cursor: cursor.rows[0] === undefined ? null : Number(cursor.rows[0].seq),
    counters,
    deadLetters: Number(dead.rows[0]?.n ?? 0),
    deletionsNotErased: Number(dead.rows[0]?.unerased ?? 0),
    jobs: Object.fromEntries(
      jobs.rows.map((row) => [
        String(row.kind),
        { oldestDueS: secondsOrNull(row.oldest_due), oldestFailingS: secondsOrNull(row.oldest_failing) },
      ]),
    ),
  };
}

function secondsOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** The checks in the book's order: replay, tombstone, account row; then the frame; then the cursor. */
async function applyFrame(tx: PoolClient, source: string, frame: IndexFrame): Promise<void> {
  const cursor = await tx.query("SELECT seq FROM idx.relay_cursor WHERE source = $1 FOR UPDATE", [source]);
  if (cursor.rows[0] !== undefined && frame.seq <= Number(cursor.rows[0].seq)) return count(tx, "ingest_replayed");
  if (await isErased(tx, frame.did)) await count(tx, "ingest_erased");
  else {
    const account = await lockAccount(tx, frame.did);
    if (account === null) await count(tx, "ingest_untracked");
    else await applyTo(tx, frame, account);
  }
  await writeCursor(tx, source, frame.seq);
}

/** Moves the cursor forward only (a seq below it is refused above, so this never writes it backwards). */
async function writeCursor(tx: PoolClient, source: string, seq: number): Promise<void> {
  await tx.query(
    `INSERT INTO idx.relay_cursor (source, seq, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (source) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at
     WHERE idx.relay_cursor.seq < excluded.seq`,
    [source, seq],
  );
}

/**
 * Waits for an erasure of this DID that is under way, and holds the next one off until this transaction ends: the
 * same per-DID advisory lock core.erase_did takes (migration 0028, step 3). Without it a write here could land between
 * erasure's deletes and its tombstone, and a table with no cascade from idx.account (idx.dead_letter) would keep it.
 * After the wait, READ COMMITTED's next statement sees the tombstone the erasure committed.
 */
async function holdErasure(tx: PoolClient, did: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('erase:' || $1::text))", [did]);
}

/**
 * The erasure tombstone's check (P3.07s, migration 0028), the first check under every path. It takes the erasure
 * lock first, so the answer holds until this transaction ends.
 */
export async function isErased(tx: PoolClient, did: string): Promise<boolean> {
  await holdErasure(tx, did);
  const { rows } = await tx.query("SELECT idx.is_erased($1) AS erased", [did]);
  return rows[0]?.erased === true;
}

/** The account row, locked for this frame; ingest never creates one (the track loop does, book P3.02s). */
export async function lockAccount(tx: PoolClient, did: string): Promise<IndexAccount | null> {
  const { rows } = await tx.query("SELECT last_rev, pds_active FROM idx.account WHERE did = $1 FOR UPDATE", [did]);
  const row = rows[0];
  if (row === undefined) return null;
  return { lastRev: typeof row.last_rev === "string" ? row.last_rev : null, active: row.pds_active === true };
}

async function applyTo(tx: PoolClient, frame: IndexFrame, account: IndexAccount): Promise<void> {
  if (frame.kind === "identity") return queueJob(tx, frame.did, "handle_check");
  if (frame.kind === "sync") return queueJob(tx, frame.did, "backfill");
  if (frame.kind === "account") return applyAccount(tx, frame);
  const plan = planCommit(account, frame.rev, frame.changes);
  if (plan.kind === "stale") return count(tx, "ingest_stale");
  if (plan.kind === "unsigned") return count(tx, "ingest_unsigned");
  if (plan.kind === "inactive") await count(tx, "ingest_inactive");
  else {
    // Order changes nothing else: the reader proves every op against the commit's one signed tree and refuses the frame
    // if any op is unproven (infrastructure/firehose, commitFrame), so a put and a delete of the same path cannot both
    // arrive.
    for (const write of await inApplyOrder(tx, frame.did, plan.writes))
      await applyWrite(tx, frame.did, plan.rev, write);
    if (plan.skipped > 0) await count(tx, "ingest_invalid", plan.skipped);
  }
  await tx.query(
    `UPDATE idx.account SET last_rev = GREATEST(last_rev, $2 COLLATE "C"), updated_at = now() WHERE did = $1`,
    [frame.did, plan.rev],
  );
}

/**
 * The in-transaction part of the account-state rule (book P3.06): an inactive status applies at once, so the account
 * leaves idx.visible_account with this frame; an active one is never taken from the stream alone but queued for
 * confirmation with getRepoStatus (ADR 0052 decision 6), which the account-state machine runs (P3.06s). An
 * unknown status with `active` false is inactive like any other.
 */
async function applyAccount(tx: PoolClient, frame: Extract<IndexFrame, { kind: "account" }>): Promise<void> {
  if (frame.active) {
    await queueJob(tx, frame.did, "confirm_status");
    await supersedeConfirmations(tx, frame.did);
    return count(tx, "ingest_account_confirm");
  }
  await hideAccount(tx, frame.did, frame.status);
  if (frame.status === "deleted") await queueJob(tx, frame.did, "confirm_deletion");
  await count(tx, "ingest_account_inactive");
}

/** The reasons app.end_sessions_for_did accepts for a PDS status (migration 0014's closed list); others are unknown. */
const SESSION_END_REASONS = new Set(["deactivated", "takendown", "suspended", "deleted"]);

/**
 * Applies an inactive status at once (book P3.06 step 2): the account leaves idx.visible_account and the member's
 * sessions end in the same transaction, through the one function that deletes sessions (migration 0014; EXECUTE
 * granted by migration 0027). A deactivated account keeps its token set, by that function's allow-list.
 */
export async function hideAccount(tx: PoolClient, did: string, status: string | null): Promise<void> {
  await tx.query("UPDATE idx.account SET pds_active = false, pds_status = $2, updated_at = now() WHERE did = $1", [
    did,
    status,
  ]);
  const why = status !== null && SESSION_END_REASONS.has(status) ? status : "unknown";
  await tx.query("SELECT app.end_sessions_for_did($1, $2)", [did, why]);
  await supersedeConfirmations(tx, did);
}

/**
 * A status newer than an answer our PDS gave before it must win: a confirm_status read must not reveal a hidden
 * account, and a confirm_deletion read must not mark deleted an account that came back or changed status. Moving
 * the jobs' due time breaks their claims (accountStore.ts), and they ask again.
 */
async function supersedeConfirmations(tx: PoolClient, did: string): Promise<void> {
  await tx.query(
    "UPDATE idx.account_job SET due_at = now() WHERE did = $1 AND kind IN ('confirm_status', 'confirm_deletion')",
    [did],
  );
}

export type JobKind = "handle_check" | "backfill" | "confirm_status" | "confirm_deletion";

export async function queueJob(tx: PoolClient, did: string, kind: JobKind): Promise<void> {
  await tx.query(
    `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at) VALUES ($1, $2, now(), 0, now())
     ON CONFLICT (did, kind) DO UPDATE SET due_at = LEAST(idx.account_job.due_at, excluded.due_at)`,
    [did, kind],
  );
}

/**
 * A commit's writes in the order they are applied, so each one is judged with room the others make: deletes first,
 * then the profile, then the sections that shrink the account, then the other sections, as the save sends them
 * (domains/profile `inSizeOrder`). A commit that keeps the account within MAX_PAGE_BYTES then never passes it
 * partway (the sizes in between only fall, then rise to the commit's own total), so a Save that grows one card and
 * shrinks another is indexed whole (Codex review of #1911).
 */
export async function inApplyOrder(tx: PoolClient, did: string, writes: readonly IndexWrite[]): Promise<IndexWrite[]> {
  const sections = writes.filter((write) => write.kind === "section");
  const { rows } = await tx.query(
    `SELECT rkey, coalesce(bytes, octet_length(record::text)) AS bytes
       FROM idx.section WHERE did = $1 AND rkey = ANY($2::text[])`,
    [did, sections.map((write) => write.rkey)],
  );
  const stored = new Map(rows.map((row) => [String(row.rkey), Number(row.bytes)]));
  const change = (write: (typeof sections)[number]) => write.bytes - (stored.get(write.rkey) ?? 0);
  return [
    ...writes.filter((write) => write.kind === "delete"),
    ...writes.filter((write) => write.kind === "profile"),
    ...sections.filter((write) => change(write) < 0),
    ...sections.filter((write) => change(write) >= 0),
  ];
}

export async function applyWrite(tx: PoolClient, did: string, rev: string, write: IndexWrite): Promise<void> {
  if (write.kind === "profile") return putProfile(tx, did, rev, write);
  if (write.kind === "section") return putSection(tx, did, rev, write);
  const uri = `at://${did}/${write.collection}/${write.rkey}`;
  // A delete older than the row it would remove leaves the row: the row came from a later commit.
  const table = write.collection === "sh.unset.profile" ? "idx.profile" : "idx.section";
  const { rowCount } = await tx.query(`DELETE FROM ${table} WHERE did = $1 AND uri = $2 AND rev <= $3`, [
    did,
    uri,
    rev,
  ]);
  if (rowCount === 0) return;
  await replaceBlobs(tx, did, uri, []);
  if (table === "idx.profile") await tx.query("UPDATE idx.section SET position = NULL WHERE did = $1", [did]);
}

async function putProfile(tx: PoolClient, did: string, rev: string, write: Extract<IndexWrite, { kind: "profile" }>) {
  const uri = `at://${did}/sh.unset.profile/self`;
  const { rowCount } = await tx.query(
    `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, avatar_cid, indexed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (did) DO UPDATE SET uri = excluded.uri, cid = excluded.cid, rev = excluded.rev,
       record = excluded.record, display_name = excluded.display_name, discoverable = excluded.discoverable,
       avatar_cid = excluded.avatar_cid, indexed_at = excluded.indexed_at
     WHERE excluded.rev >= idx.profile.rev`,
    [did, uri, write.cid, rev, write.record, write.displayName, write.discoverable, write.avatarCid],
  );
  if (rowCount === 0) return;
  await replaceBlobs(tx, did, uri, write.blobs);
  // Each card's place in the profile's `cards` list of at:// addresses (ADR 0086), or null when it is not listed.
  await tx.query(
    `UPDATE idx.section s SET position = (
       SELECT (o.ord - 1)::integer FROM jsonb_array_elements(p.record -> 'cards') WITH ORDINALITY AS o(ref, ord)
        WHERE o.ref ->> 'uri' = s.uri ORDER BY o.ord LIMIT 1)
       FROM idx.profile p WHERE p.did = s.did AND s.did = $1`,
    [did],
  );
}

async function putSection(tx: PoolClient, did: string, rev: string, write: Extract<IndexWrite, { kind: "section" }>) {
  const uri = `at://${did}/sh.unset.card/${write.rkey}`;
  const room = await sectionRoom(tx, did, uri, write.bytes);
  if (room === "count") return count(tx, "ingest_capped");
  if (room === "bytes") {
    // As for a record planCommit refuses: the older version under this key goes, so the page never shows a card
    // its member has since changed (a backfill of the repo would not index it either).
    await applyWrite(tx, did, rev, { kind: "delete", collection: "sh.unset.card", rkey: write.rkey });
    return count(tx, "ingest_over_budget");
  }
  const { rowCount } = await tx.query(
    `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, bytes, position, indexed_at)
     VALUES ($1, $2::types.did, $3, $4, $5, $6, $7, (
       SELECT (o.ord - 1)::integer FROM idx.profile p,
              jsonb_array_elements(p.record -> 'cards') WITH ORDINALITY AS o(ref, ord)
        WHERE p.did = $2::types.did AND o.ref ->> 'uri' = $1 ORDER BY o.ord LIMIT 1), now())
     ON CONFLICT (uri) DO UPDATE SET cid = excluded.cid, rev = excluded.rev, record = excluded.record,
       bytes = excluded.bytes, position = excluded.position, indexed_at = excluded.indexed_at
     WHERE excluded.rev >= idx.section.rev AND idx.section.did = excluded.did`,
    [uri, did, write.rkey, write.cid, rev, write.record, write.bytes],
  );
  if (rowCount !== 0) await replaceBlobs(tx, did, uri, write.blobs);
}

/**
 * Whether the section fits its account: a section already indexed may change, and a new one fits while the account
 * holds fewer than the cap ("count" when not); and the account's other sections and this one together stay within
 * MAX_PAGE_BYTES ("bytes" when not), as the save counts them (domains/profile `fitsPage`). The frame holds the account
 * row's lock (lockAccount), so no other write to this account's sections runs between this count and the write (DA-4).
 * A size an older indexer left out counts as its jsonb text, as migration 0040 fills it.
 */
async function sectionRoom(tx: PoolClient, did: string, uri: string, bytes: number): Promise<"ok" | "count" | "bytes"> {
  const { rows } = await tx.query(
    `SELECT EXISTS (SELECT 1 FROM idx.section WHERE did = $1 AND uri = $2) AS known,
            (SELECT count(*) FROM idx.section WHERE did = $1) AS held,
            (SELECT coalesce(sum(coalesce(bytes, octet_length(record::text))), 0)
               FROM idx.section WHERE did = $1 AND uri <> $2) AS others,
            (SELECT coalesce(bytes, octet_length(record::text)) FROM idx.section WHERE did = $1 AND uri = $2) AS mine`,
    [did, uri],
  );
  const row = rows[0];
  if (row?.known !== true && !(Number(row?.held) < MAX_SECTIONS_PER_ACCOUNT)) return "count";
  // A card that does not grow never makes the page worse, so it is kept even on a page indexed past the budget before
  // the budget existed (Codex review of #1911); the public read still stops at the budget.
  if (row?.mine !== null && row?.mine !== undefined && bytes <= Number(row.mine)) return "ok";
  return Number(row?.others) + bytes <= MAX_PAGE_BYTES ? "ok" : "bytes";
}

export async function replaceBlobs(tx: PoolClient, did: string, uri: string, blobs: readonly BlobRef[]): Promise<void> {
  await tx.query("DELETE FROM idx.record_blob WHERE did = $1 AND uri = $2", [did, uri]);
  for (const blob of blobs) {
    await tx.query("INSERT INTO idx.record_blob (uri, cid, did, mime, size) VALUES ($1, $2, $3, $4, $5)", [
      uri,
      blob.cid,
      did,
      blob.mime,
      blob.size,
    ]);
  }
}

export async function count(tx: PoolClient, name: Counter, by = 1): Promise<void> {
  await tx.query(
    `INSERT INTO idx.ingest_stat (name, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (name) DO UPDATE SET value = idx.ingest_stat.value + excluded.value, updated_at = excluded.updated_at`,
    [name, by],
  );
}
