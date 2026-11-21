// The member's profile cards: sh.unset.card records in their own repo (ADR 0051), over pdsCall. Values are
// returned unparsed; domains/profile reads them. Calls and errors: @atproto/api 0.30.3 com.atproto.repo.listRecords,
// createRecord, deleteRecord (dist/client/types/com/atproto/repo/*.d.ts) and com.atproto.sync.getLatestCommit;
// record keys: atproto.com/specs/record-key.
import { TID } from "@atproto/common-web";
import type { Did } from "@unset/domains-identity";
import { NetGuardError } from "@unset/infrastructure-net-guard";
import type { PdsContext, PdsResult } from "./pds-call.ts";
import { type BuiltRecord, isXrpcError, type PdsCall, type SaveOutcome, saveRecord } from "./repo-record.ts";

export const CARD_COLLECTION = "sh.unset.card";

/**
 * How the cards are read (Codex on #1657; coordinator 2026-11-17 07:04Z). Every PDS response is capped at 1 MiB
 * (net-guard libraryFetch), and one card may be about 900 KB, so the cards come in pages of PAGE records; a page past
 * the cap is read again one record at a time. One page load makes at most MAX_CALLS calls and keeps at most
 * MAX_BYTES of record JSON, and stops at MAX_CARDS cards (LIMITS.profile.cardsMax), all inside the request's deadline.
 * When it stops early, the list says it is incomplete, and the caller shows what it has, never more.
 */
const PAGE = 10;
const MAX_CALLS = 24;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CARDS = 100;

export type StoredCard = { readonly key: string; readonly value: unknown; readonly cid: string };
/**
 * The cards read, whether that is all of them, and whether more than MAX_CARDS are stored (`overflow`: a writer
 * outside this app can pass the cap; the list then holds the first MAX_CARDS and is not complete). A list cut short by
 * the budget below has `overflow` false: how many cards remain is unknown.
 */
export type CardList = {
  readonly cards: readonly StoredCard[];
  readonly complete: boolean;
  readonly overflow: boolean;
};

/** The record key of `uri` when it names a card in `did`'s own repo, else null. */
function ownCardKey(uri: string, did: Did): string | null {
  const prefix = `at://${did}/${CARD_COLLECTION}/`;
  const key = uri.startsWith(prefix) ? uri.slice(prefix.length) : "";
  return /^[A-Za-z0-9._:~-]{1,512}$/.test(key) && key !== "." && key !== ".." ? key : null;
}

/** True when net-guard refused the response for its size; @atproto/xrpc wraps it as the cause (XRPCError.from). */
function tooLarge(error: unknown): boolean {
  for (let cause = error, depth = 0; cause instanceof Error && depth < 4; cause = cause.cause, depth += 1) {
    if (cause instanceof NetGuardError && cause.code === "egress.too_large") return true;
  }
  return false;
}

type Page = { readonly records: StoredCard[]; readonly bytes: number; readonly cursor: string | undefined };
const TOO_LARGE = "too_large" as const;

function readPage(pdsCall: PdsCall, ctx: PdsContext | null, did: Did, limit: number, cursor: string | undefined) {
  return pdsCall(
    ctx,
    did,
    async (agent): Promise<Page | typeof TOO_LARGE> => {
      try {
        const { data } = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection: CARD_COLLECTION,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const records = data.records.flatMap((r) => {
          const key = ownCardKey(r.uri, did);
          return key === null ? [] : [{ key, value: r.value, cid: r.cid }];
        });
        const bytes = records.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r.value)), 0);
        const more = data.records.length > 0 && typeof data.cursor === "string" && data.cursor !== cursor;
        return { records, bytes, cursor: more ? data.cursor : undefined };
      } catch (error: unknown) {
        if (tooLarge(error)) return TOO_LARGE;
        throw error;
      }
    },
    { idempotent: true },
  );
}

/**
 * The member's cards, page by page within the budget above. A record the PDS returns for another repo or collection
 * is left out. A failure before any card is read is the failure; after some are read, the list is incomplete.
 */
export async function listCardRecords(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
): Promise<PdsResult<CardList>> {
  const cards: StoredCard[] = [];
  let bytes = 0;
  let cursor: string | undefined;
  // After a page past the cap, the next PAGE cards are read one at a time, then pages resume.
  let single = 0;
  for (let calls = 0; calls < MAX_CALLS; calls += 1) {
    const limit = single > 0 ? 1 : PAGE;
    if (ctx?.deadline.aborted === true) break;
    const page = await readPage(pdsCall, ctx, did, limit, cursor);
    if (page.kind !== "ok") return cards.length === 0 || page.kind !== "transient" ? page : partial(cards);
    if (page.value === TOO_LARGE) {
      // One record alone past the cap cannot be read, and its key is unknown, so the read stops before it.
      if (limit === 1) break;
      single = PAGE;
      continue;
    }
    single = Math.max(0, single - 1);
    cards.push(...page.value.records);
    bytes += page.value.bytes;
    if (page.value.cursor === undefined) return listed(cards, cards.length <= MAX_CARDS);
    cursor = page.value.cursor;
    // One page past MAX_CARDS is read, so exactly MAX_CARDS cards still end with an empty last page and count as all.
    if (cards.length > MAX_CARDS || bytes > MAX_BYTES) break;
  }
  return partial(cards);
}

const listed = (cards: readonly StoredCard[], complete: boolean): PdsResult<CardList> => ({
  kind: "ok",
  value: { cards: cards.slice(0, MAX_CARDS), complete, overflow: cards.length > MAX_CARDS },
});
const partial = (cards: readonly StoredCard[]) => listed(cards, false);

/**
 * The CID of the member's repo head (com.atproto.sync.getLatestCommit), for a create that must land on the repo state
 * a count was read from. The PDS accepts the member's own OAuth token here without a scope check
 * (@atproto/pds 0.5.51 api/com/atproto/sync/getLatestCommit.ts, authorizationOrAdminTokenOptional).
 */
export function latestCommit(pdsCall: PdsCall, ctx: PdsContext | null, did: Did): Promise<PdsResult<string>> {
  return pdsCall(ctx, did, async (agent) => (await agent.com.atproto.sync.getLatestCommit({ did })).data.cid, {
    idempotent: true,
  });
}

export type CreateOutcome =
  | { readonly kind: "created"; readonly key: string; readonly rev?: string }
  /** The repo's head was no longer `swapCommit`: something else was written first, and nothing was created. */
  | { readonly kind: "changed" };

/**
 * A new card's record key, for a card web must name before it is written (a picture card records its picture's use
 * first): a TID as the PDS itself would pick one (atproto.com/specs/tid; @atproto/common-web 0.5.17 TID.nextStr).
 */
export const newCardKey = (): string => TID.nextStr();

/**
 * Creates a card, only if the repo's head is still `swapCommit` (compare-and-swap on the whole repo: createRecord
 * `swapCommit`; @atproto/pds 0.5.51 checks it inside the repo's write transaction, processWrites, and answers
 * InvalidSwap, writing nothing). The PDS picks the key (a TID) unless `rkey` names one (newCardKey). Not retried: a
 * retry could create it twice.
 */
export function createCardRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  record: Readonly<Record<string, unknown>>,
  swapCommit: string,
  rkey?: string,
): Promise<PdsResult<CreateOutcome>> {
  return pdsCall(
    ctx,
    did,
    async (agent): Promise<CreateOutcome> => {
      try {
        const { data } = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection: CARD_COLLECTION,
          record: { ...record },
          swapCommit,
          ...(rkey === undefined ? {} : { rkey }),
        });
        const key = ownCardKey(data.uri, did);
        if (key === null) throw new Error("createRecord returned a record outside this repo");
        return data.commit === undefined ? { kind: "created", key } : { kind: "created", key, rev: data.commit.rev };
      } catch (error: unknown) {
        if (isXrpcError(error, "InvalidSwap")) return { kind: "changed" };
        throw error;
      }
    },
    { idempotent: false },
  );
}

/**
 * Edits one card with compare-and-swap (saveRecord). A card that is gone is refused as `card.missing`, never
 * recreated: the key came from a page the member loaded earlier, and a deleted card stays deleted.
 */
export function saveCardRecord<C extends string>(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  key: string,
  build: (existing: unknown) => BuiltRecord<C>,
): Promise<PdsResult<SaveOutcome<C | "card.missing">>> {
  return saveRecord<C | "card.missing">(pdsCall, ctx, did, { collection: CARD_COLLECTION, rkey: key }, (existing) =>
    existing === null ? { ok: false, code: "card.missing" } : build(existing),
  );
}

/**
 * `rev`: the last landed commit's revision (a TID), when the PDS gave one. `versions`: each written card's new record
 * CID, for the cards the PDS named in its answer (absent when it named none).
 */
export type WrittenVersion = { readonly key: string; readonly cid: string };
export type SaveManyOutcome =
  | { readonly kind: "saved"; readonly rev?: string; readonly versions?: readonly WrittenVersion[] }
  /** The repo's head was no longer `swapCommit`: something was written first, and none of the cards was written. */
  | { readonly kind: "changed" }
  /** This card alone would pass the PDS's JSON body limit, so nothing was sent and nothing was written. */
  | { readonly kind: "too_large"; readonly key: string }
  /** The cards did not fit one call; the first calls landed, a later one did not. `saved` are the cards written. */
  | {
      readonly kind: "partial";
      readonly saved: readonly string[];
      readonly rev?: string;
      readonly versions?: readonly WrittenVersion[];
    };

/**
 * The most bytes of JSON one applyWrites body may hold. @atproto/pds 0.5.51 parses most JSON bodies up to 150 KiB
 * (dist/index.js:155) but raises applyWrites and putRecord to `jsonLimit: 1_000_000`
 * (dist/api/com/atproto/repo/applyWrites.js:50), and net-guard caps every atproto request but uploadBlob at 1 MiB
 * (infrastructure/net-guard/src/libraryFetch.ts); the smaller, the PDS's, binds. Checked on the pinned image by
 * tests/integration/pds-apply-writes.image.test.ts.
 */
export const APPLY_WRITES_BODY_BYTES = 1_000_000;
/** Room for the swapCommit of a later call, which is another CID of the same length, and rounding. */
const BODY_SLACK_BYTES = 64;

type Update = { readonly key: string; readonly record: Readonly<Record<string, unknown>> };
type CardWriteOp = {
  readonly $type: "com.atproto.repo.applyWrites#update";
  readonly collection: typeof CARD_COLLECTION;
  readonly rkey: string;
  readonly value: Record<string, unknown>;
};
type Batch = { readonly keys: string[]; readonly writes: CardWriteOp[] };

/**
 * The updates in order, packed into as few applyWrites bodies as fit the PDS's limit: almost always one. Each body
 * is measured as the JSON we send (`JSON.stringify`, as @atproto/api's fetch handler encodes it). A card that alone
 * does not fit is returned by key.
 */
function batches(did: Did, updates: readonly Update[], swapCommit: string): Batch[] | { readonly tooLarge: string } {
  const base = Buffer.byteLength(JSON.stringify({ repo: did, swapCommit, writes: [] })) + BODY_SLACK_BYTES;
  const packed: Batch[] = [];
  let current: Batch = { keys: [], writes: [] };
  let size = base;
  for (const update of updates) {
    const write: CardWriteOp = {
      $type: "com.atproto.repo.applyWrites#update",
      collection: CARD_COLLECTION,
      rkey: update.key,
      value: { ...update.record },
    };
    const bytes = Buffer.byteLength(JSON.stringify(write)) + 1;
    if (base + bytes > APPLY_WRITES_BODY_BYTES) return { tooLarge: update.key };
    if (size + bytes > APPLY_WRITES_BODY_BYTES) {
      packed.push(current);
      current = { keys: [], writes: [] };
      size = base;
    }
    current.keys.push(update.key);
    current.writes.push(write);
    size += bytes;
  }
  packed.push(current);
  return packed;
}

/**
 * Writes over several cards (ADR 0074), each call of com.atproto.repo.applyWrites all or none, and only if the repo's
 * head is still `swapCommit`. @atproto/pds 0.5.51 (dist/api/com/atproto/repo/applyWrites.js) refuses more than 200
 * writes, checks the grant once for each action and collection, and applies a call in one processWrites transaction,
 * answering InvalidSwap with nothing written when the head moved. A write has no per-record swap, so the caller
 * checks each card's version against a list read on the same head.
 *
 * Cards that do not fit one call (past about 1 MB of changed text) go in several, each swapping on the commit the
 * one before it returned (applyWrites.js answers `commit.cid`), so no other write can land between them unnoticed:
 * one that does stops the chain. A refusal or failure of the first call is the caller's, as for one call; of a later
 * call it is `partial`, naming the cards already written (pdsCall has already logged an unexpected error). Not
 * retried here: the caller re-reads and decides (RE-1, one layer).
 */
export async function saveCardRecords(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  updates: readonly Update[],
  swapCommit: string,
): Promise<PdsResult<SaveManyOutcome>> {
  if (updates.length === 0) return { kind: "ok", value: { kind: "saved" } };
  const packed = batches(did, updates, swapCommit);
  if (!Array.isArray(packed)) return { kind: "ok", value: { kind: "too_large", key: packed.tooLarge } };
  const saved: string[] = [];
  let head: string | undefined = swapCommit;
  let rev: string | undefined;
  const versions: WrittenVersion[] = [];
  const landed = () => ({ ...(rev === undefined ? {} : { rev }), ...(versions.length === 0 ? {} : { versions }) });
  const partial = (): SaveManyOutcome => ({ kind: "partial", saved, ...landed() });
  for (const batch of packed) {
    if (head === undefined) return { kind: "ok", value: partial() };
    const result = await applyCardWrites(pdsCall, ctx, did, batch.writes, head);
    const first = saved.length === 0;
    if (result.kind !== "ok") return first ? result : { kind: "ok", value: partial() };
    if (result.value === "changed") return { kind: "ok", value: first ? { kind: "changed" } : partial() };
    saved.push(...batch.keys);
    versions.push(...writtenVersions(did, batch.keys, result.value.results));
    head = result.value.commit;
    rev = result.value.rev;
  }
  return { kind: "ok", value: { kind: "saved", ...landed() } };
}

/**
 * The new CID of each card the call wrote, from applyWrites' `results` (@atproto/api 0.30.3, UpdateResult
 * { uri, cid }): only a result for one of `keys`, at its own record's URI in this repo, counts.
 */
function writtenVersions(did: Did, keys: readonly string[], results: unknown): WrittenVersion[] {
  if (!Array.isArray(results)) return [];
  return results.flatMap((result: unknown) => {
    if (typeof result !== "object" || result === null) return [];
    const { uri, cid } = result as Record<string, unknown>;
    const key = keys.find((k) => uri === `at://${did}/${CARD_COLLECTION}/${k}`);
    return key === undefined || typeof cid !== "string" ? [] : [{ key, cid }];
  });
}

/** One applyWrites call: the new head's CID and revision when it landed (absent if the PDS did not say), or `changed`. */
function applyCardWrites(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  writes: CardWriteOp[],
  swapCommit: string,
): Promise<
  PdsResult<
    { readonly commit: string | undefined; readonly rev: string | undefined; readonly results: unknown } | "changed"
  >
> {
  return pdsCall(
    ctx,
    did,
    async (agent) => {
      try {
        const { data } = await agent.com.atproto.repo.applyWrites({ repo: did, swapCommit, writes });
        return { commit: data.commit?.cid, rev: data.commit?.rev, results: data.results };
      } catch (error: unknown) {
        if (isXrpcError(error, "InvalidSwap")) return "changed" as const;
        throw error;
      }
    },
    { idempotent: false },
  );
}

/** Deletes one card. Not retried. */
export function deleteCardRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  key: string,
): Promise<PdsResult<void>> {
  return pdsCall(
    ctx,
    did,
    async (agent) => {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection: CARD_COLLECTION, rkey: key });
    },
    { idempotent: false },
  );
}
