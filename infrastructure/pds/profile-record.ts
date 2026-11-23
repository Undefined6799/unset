// The member's sh.unset.profile record (Alex 2026-10-23: the profile page), read from and written to their own repo.
// The record key is the lexicon's literal "self" (shared/lexicons/schemas/sh.unset.profile.json).
import type { Did } from "@unset/domains-identity";
import type { PdsContext, PdsResult } from "./pds-call.ts";
import {
  type BuiltRecord,
  loadRecord,
  type PdsCall,
  type SaveOutcome,
  type StoredRecord,
  saveRecord,
} from "./repo-record.ts";

export const PROFILE_COLLECTION = "sh.unset.profile";
export const PROFILE_RKEY = "self";
export const PROFILE = { collection: PROFILE_COLLECTION, rkey: PROFILE_RKEY } as const;

export function loadProfileRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
): Promise<PdsResult<StoredRecord | null>> {
  return loadRecord(pdsCall, ctx, did, PROFILE);
}

/** Read, build and compare-and-swap write of the profile; see saveRecord. A first profile cannot overwrite another. */
export function saveProfileRecord<C extends string>(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  build: (existing: unknown) => BuiltRecord<C>,
): Promise<PdsResult<SaveOutcome<C>>> {
  return saveRecord(pdsCall, ctx, did, PROFILE, build);
}
