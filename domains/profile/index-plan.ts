// What the index keeps of a member's published profile (book P3.05s, "P3.00 refinement for the own-PDS profile slice";
// ADRs 0051, 0052, 0058). Pure rules: from the account as the index has it and one verified commit, the writes to make.
// The store applies them in the commit's own transaction (infrastructure/postgres, indexStore.ts).
//
// Records are untrusted member content even after the signature check: each one is validated against its lexicon
// (shared/lexicons, read mode, so a field a newer client adds is kept) and capped in size before it is stored.
import { LIMITS, NSID, validateRecord } from "@unset/shared-lexicons";
import { parseCardKey } from "./cards.ts";

/** The collections the index reads; every other op in a commit is ignored. */
export const INDEXED_COLLECTIONS = [NSID.profile, NSID.section] as const;
export type IndexedCollection = (typeof INDEXED_COLLECTIONS)[number];

/**
 * A record's stored JSON is capped, so one member cannot fill the index (coordinator review, 2026-11-18). The cap is
 * the most one PDS write may carry (APPLY_WRITES_BODY_BYTES in infrastructure/pds/card-records.ts, the pinned PDS's
 * applyWrites and putRecord `jsonLimit`), so every record a member can save through our PDS is kept, and the save
 * refuses, with `fitsIndex`, the few the cap still leaves out (book P3.12v). It was 64 KiB, under the
 * lexicon's 100,000-byte text and its 100-entry collections (about 620 KB at every field's limit), so such a card saved
 * and never showed publicly (staging break test 2026-11-21).
 */
export const MAX_RECORD_BYTES = 1_000_000;
/**
 * All of a member's cards together, as `recordBytes` counts them: the most the index keeps for one account, the most
 * the public page reads, and the most the owner's own card list reads (CARD_LIST_BYTES in infrastructure/pds,
 * card-records.ts, held equal by a test). Without it, 200 cards of up to MAX_RECORD_BYTES each would make one page of
 * about 191 MiB, which web would read and render for any visitor (review of #1911). 4 MiB is the number the owner's
 * list already stopped at (book P3.12v; the number is Alex's to set).
 */
export const MAX_PAGE_BYTES = 4 * 1024 * 1024;
/** Sections kept per account: the profile lists at most LIMITS.profile.cardsMax, and unlisted ones show after. */
export const MAX_SECTIONS_PER_ACCOUNT = 2 * LIMITS.profile.cardsMax;

/** One proven change from a commit, with the record in its JSON form (blob refs as `{ $type: "blob", ref: { $link } }`). */
export type IndexChange =
  | {
      readonly kind: "put";
      readonly collection: string;
      readonly rkey: string;
      readonly cid: string;
      readonly record: unknown;
    }
  | { readonly kind: "delete"; readonly collection: string; readonly rkey: string };

/** The account row's two facts a commit is judged by. A null `lastRev` means no commit has been applied yet. */
export type IndexAccount = { readonly lastRev: string | null; readonly active: boolean };

export type BlobRef = { readonly cid: string; readonly mime: string; readonly size: number };

export type IndexWrite =
  | {
      readonly kind: "profile";
      readonly cid: string;
      readonly record: Readonly<Record<string, unknown>>;
      readonly displayName: string;
      readonly discoverable: boolean;
      readonly avatarCid: string | null;
      readonly blobs: readonly BlobRef[];
    }
  | {
      readonly kind: "section";
      readonly rkey: string;
      readonly cid: string;
      readonly record: Readonly<Record<string, unknown>>;
      readonly blobs: readonly BlobRef[];
      /** The record's size as `recordBytes` counts it, which the store keeps to hold the account to MAX_PAGE_BYTES. */
      readonly bytes: number;
    }
  | { readonly kind: "delete"; readonly collection: IndexedCollection; readonly rkey: string };

export type IndexPlan =
  /** Older than what the index already has (revs are TIDs and sort as strings, atproto.com/specs/tid). */
  | { readonly kind: "stale" }
  /** No signed rev (a commit with no ops): nothing to apply and nothing to move the watermark with. */
  | { readonly kind: "unsigned" }
  /** The PDS says the account is not active: ignore its commits but move the watermark (atproto.com/specs/sync). */
  | { readonly kind: "inactive"; readonly rev: string }
  | { readonly kind: "apply"; readonly rev: string; readonly writes: readonly IndexWrite[]; readonly skipped: number };

/** Decides what one commit does to the index, in the book's order: rev guard, account state, then each op. */
export function planCommit(account: IndexAccount, rev: string | null, changes: readonly IndexChange[]): IndexPlan {
  if (rev === null) return { kind: "unsigned" };
  if (account.lastRev !== null && rev < account.lastRev) return { kind: "stale" };
  if (!account.active) return { kind: "inactive", rev };
  const writes: IndexWrite[] = [];
  let skipped = 0;
  for (const change of changes) {
    if (!isIndexed(change.collection)) continue;
    const write = change.kind === "delete" ? deleteOf(change.collection, change.rkey) : putOf(change);
    if (write !== null) {
      writes.push(write);
      continue;
    }
    skipped += 1;
    // A put we refuse under a key we index replaces the record in the repo: an older version indexed under that key
    // goes, as a backfill of the repo would remove it, so the stream and a rebuild show the same (outside review,
    // 2026-11-19). The store's rev guard keeps a newer row.
    if (change.kind === "put") {
      const removal = deleteOf(change.collection, change.rkey);
      if (removal !== null) writes.push(removal);
    }
  }
  return { kind: "apply", rev, writes, skipped };
}

function isIndexed(collection: string): collection is IndexedCollection {
  return (INDEXED_COLLECTIONS as readonly string[]).includes(collection);
}

function deleteOf(collection: IndexedCollection, rkey: string): IndexWrite | null {
  return keyFits(collection, rkey) ? { kind: "delete", collection, rkey } : null;
}

/** A put the lexicon accepts, under its record key type, within the size cap; anything else is skipped and counted. */
function putOf(change: Extract<IndexChange, { kind: "put" }>): IndexWrite | null {
  const collection = change.collection as IndexedCollection;
  if (!keyFits(collection, change.rkey) || !fitsIndex(change.record)) return null;
  const checked = validateRecord(collection, change.record, "read");
  if (!checked.ok) return null;
  const record = checked.value;
  const blobs = blobRefs(record);
  if (collection === NSID.section) {
    return { kind: "section", rkey: change.rkey, cid: change.cid, record, blobs, bytes: recordBytes(record) };
  }
  return {
    kind: "profile",
    cid: change.cid,
    record,
    displayName: typeof record.displayName === "string" ? record.displayName : "",
    discoverable: record.listed === true,
    avatarCid: blobCid(record.avatar),
    blobs,
  };
}

/** The lexicon's record key type: `literal:self` for the profile, `tid` for a section (atproto.com/specs/record-key). */
function keyFits(collection: IndexedCollection, rkey: string): boolean {
  return collection === NSID.profile ? rkey === "self" : TID.test(rkey) && parseCardKey(rkey) !== null;
}

/** atproto.com/specs/tid: 13 characters of base32-sortable, the first in 2-7 or a-j. */
const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

/**
 * Whether the index keeps `record`: within MAX_RECORD_BYTES and storable. The save checks the record it writes with
 * this same function, so a record the owner can save and see is never one the public page leaves out.
 */
export function fitsIndex(record: unknown): boolean {
  return recordBytes(record) <= MAX_RECORD_BYTES && storable(record);
}

/**
 * A record's size: the bytes of its JSON in UTF-8, as the save, the index and the owner's card list all count it.
 * A value JSON cannot encode is not a record, and counts as too large for anything.
 */
export function recordBytes(record: unknown): number {
  try {
    const json = JSON.stringify(record);
    return typeof json === "string" ? new TextEncoder().encode(json).byteLength : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Whether a member's cards fit MAX_PAGE_BYTES once `writes` are made (a new card's key is one `stored` does not hold).
 * `stored` is every card they hold now, as their repo lists them; a card a write names is replaced, not added to. The
 * save refuses writes that would not fit, and the index skips a card that does not (indexStore.ts), so what the owner
 * saves is what the page shows.
 */
export function fitsPage(
  stored: readonly { readonly key: string; readonly value: unknown }[],
  writes: readonly { readonly key: string | null; readonly record: unknown }[],
): boolean {
  const written = new Set(writes.map((write) => write.key));
  let bytes = 0;
  for (const write of writes) bytes += recordBytes(write.record);
  for (const card of stored) if (!written.has(card.key)) bytes += recordBytes(card.value);
  return bytes <= MAX_PAGE_BYTES;
}

/**
 * `writes` in the order to send them: the ones that shrink the page against `stored` first, then the rest, each group
 * in the order given. The size then only falls and then rises to the Save's own total, so a Save the PDS takes in
 * several commits never passes MAX_PAGE_BYTES between them, and the index, which judges each commit in turn, keeps
 * every card of a Save that fits (Codex review of #1911). The indexer orders the cards within one commit by the same
 * rule (indexStore.ts `inApplyOrder`).
 */
export function inSizeOrder<W extends { readonly key: string | null; readonly record: unknown }>(
  stored: readonly { readonly key: string; readonly value: unknown }[],
  writes: readonly W[],
): W[] {
  const before = new Map(stored.map((card) => [card.key, recordBytes(card.value)]));
  const change = (write: W) => recordBytes(write.record) - (write.key === null ? 0 : (before.get(write.key) ?? 0));
  return [...writes.filter((write) => change(write) < 0), ...writes.filter((write) => change(write) >= 0)];
}

/**
 * Postgres's jsonb refuses a NUL character and a lone surrogate in any string or key (postgresql.org/docs/current/
 * datatype-json.html), and a record it refuses would fail its frame's transaction on every retry. Such a record passes
 * the lexicon, so it is skipped here as invalid.
 */
function storable(value: unknown): boolean {
  if (typeof value === "string") return value.isWellFormed() && !value.includes("\0");
  if (Array.isArray(value)) return value.every(storable);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).every(([key, child]) => storable(key) && storable(child));
  }
  return true;
}

/** Every blob ref anywhere in the record, once each, so the media proxy serves only referenced blobs (P3.09). */
function blobRefs(value: unknown, found = new Map<string, BlobRef>()): BlobRef[] {
  if (Array.isArray(value)) for (const item of value) blobRefs(item, found);
  else if (typeof value === "object" && value !== null) {
    const ref = blobRef(value as Record<string, unknown>);
    if (ref !== null) found.set(ref.cid, ref);
    else for (const child of Object.values(value)) blobRefs(child, found);
  }
  return [...found.values()];
}

function blobRef(value: Record<string, unknown>): BlobRef | null {
  const cid = blobCid(value);
  const { mimeType, size } = value;
  if (cid === null || typeof mimeType !== "string" || !Number.isSafeInteger(size)) return null;
  return { cid, mime: mimeType, size: size as number };
}

function blobCid(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { $type, ref } = value as Record<string, unknown>;
  if ($type !== "blob" || typeof ref !== "object" || ref === null) return null;
  const link = (ref as Record<string, unknown>).$link;
  return typeof link === "string" ? link : null;
}
