// The member's main page (ADR 0091): the sh.unset.page record under the key "self", which lists the cards it shows.
// The lexicon's key type is "any", so other pages can come later under other keys; this reads and names only the main
// page. Writes go with the card they list, in one commit (card-records.ts writeCardAndList).
import type { Did } from "@unset/domains-identity";
import type { PdsContext, PdsResult } from "./pds-call.ts";
import { loadRecord, type PdsCall, type StoredRecord } from "./repo-record.ts";

export const PAGE_COLLECTION = "sh.unset.page";
export const MAIN_PAGE_RKEY = "self";

export function loadPageRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
): Promise<PdsResult<StoredRecord | null>> {
  return loadRecord(pdsCall, ctx, did, { collection: PAGE_COLLECTION, rkey: MAIN_PAGE_RKEY });
}
