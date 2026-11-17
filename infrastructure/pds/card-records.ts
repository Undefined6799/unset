// The member's profile cards: sh.unset.section records in their own repo (ADR 0051), over pdsCall. Values are
// returned unparsed; domains/profile reads them. Calls and errors: @atproto/api 0.30.3 com.atproto.repo.listRecords,
// createRecord, deleteRecord (dist/client/types/com/atproto/repo/*.d.ts); record keys: atproto.com/specs/record-key.
import type { Did } from "@unset/domains-identity";
import type { PdsContext, PdsResult } from "./pds-call.ts";
import { type BuiltRecord, type PdsCall, type SaveOutcome, saveRecord } from "./repo-record.ts";

export const CARD_COLLECTION = "sh.unset.section";
/** One page: the profile's cards list holds at most 100 keys (LIMITS.profile.cardsMax), and 100 is listRecords' max. */
const CARDS_PAGE = 100;

export type StoredCard = { readonly key: string; readonly value: unknown; readonly cid: string };

/** The record key of `uri` when it names a card in `did`'s own repo, else null. */
function ownCardKey(uri: string, did: Did): string | null {
  const prefix = `at://${did}/${CARD_COLLECTION}/`;
  const key = uri.startsWith(prefix) ? uri.slice(prefix.length) : "";
  return /^[A-Za-z0-9._:~-]{1,512}$/.test(key) && key !== "." && key !== ".." ? key : null;
}

/** The member's cards, first page only. A record the PDS returns for another repo or collection is left out. */
export function listCardRecords(pdsCall: PdsCall, ctx: PdsContext | null, did: Did): Promise<PdsResult<StoredCard[]>> {
  return pdsCall(
    ctx,
    did,
    async (agent) => {
      const { data } = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: CARD_COLLECTION,
        limit: CARDS_PAGE,
      });
      return data.records.flatMap((r) => {
        const key = ownCardKey(r.uri, did);
        return key === null ? [] : [{ key, value: r.value, cid: r.cid }];
      });
    },
    { idempotent: true },
  );
}

/** Creates a card; the PDS picks its key (a TID). Not retried: a retry could create it twice. */
export function createCardRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  record: Readonly<Record<string, unknown>>,
): Promise<PdsResult<{ readonly key: string }>> {
  return pdsCall(
    ctx,
    did,
    async (agent) => {
      const { data } = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: CARD_COLLECTION,
        record: { ...record },
      });
      const key = ownCardKey(data.uri, did);
      if (key === null) throw new Error("createRecord returned a record outside this repo");
      return { key };
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
