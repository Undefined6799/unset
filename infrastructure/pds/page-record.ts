// The member's main page (ADR 0091): the sh.unset.page record under the key "self", which lists the cards it shows.
// The lexicon's key type is "any", so other pages can come later under other keys; this reads and names only the main
// page. Card list writes go with the card they list, in one commit (card-records.ts writeCardAndList); who sees the
// page (its visibility) is written alone, with a compare-and-swap on the page (savePageRecord).
import type { Did } from "@unset/domains-identity";
import type { PdsContext, PdsResult } from "./pds-call.ts";
import { PROFILE } from "./profile-record.ts";
import {
  type BuiltRecord,
  loadRecord,
  loadRecordPair,
  type PdsCall,
  type SaveOutcome,
  type StoredRecord,
  saveRecord,
} from "./repo-record.ts";

export const PAGE_COLLECTION = "sh.unset.page";
export const MAIN_PAGE_RKEY = "self";
const MAIN_PAGE = { collection: PAGE_COLLECTION, rkey: MAIN_PAGE_RKEY } as const;

export function loadPageRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
): Promise<PdsResult<StoredRecord | null>> {
  return loadRecord(pdsCall, ctx, did, MAIN_PAGE);
}

/** Read, build and compare-and-swap write of the main page; see saveRecord. A first page cannot overwrite another. */
export function savePageRecord<C extends string>(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  build: (existing: unknown) => BuiltRecord<C>,
): Promise<PdsResult<SaveOutcome<C>>> {
  return saveRecord(pdsCall, ctx, did, MAIN_PAGE, build);
}

/** The member's profile and main page, read in one PDS call (Settings › Privacy shows both). */
export function loadProfileAndPage(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
): Promise<PdsResult<readonly [StoredRecord | null, StoredRecord | null]>> {
  return loadRecordPair(pdsCall, ctx, did, PROFILE, MAIN_PAGE);
}
