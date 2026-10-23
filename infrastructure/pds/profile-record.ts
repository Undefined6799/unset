// The member's sh.unset.profile record (Alex 2026-10-23: the profile page), read from their own repo over pdsCall.
// The record key is the lexicon's literal "self" (shared/lexicons/schemas/sh.unset.profile.json). A repo without the
// record answers RecordNotFound (@atproto/api 0.27.0 com.atproto.repo.getRecord, RecordNotFoundError), which is not a
// failure: the member has not published a profile yet. The value is returned unparsed; domains/profile reads it.
import type { Agent } from "@atproto/api";
import type { Did } from "@unset/domains-identity";
import type { PdsContext, PdsResult } from "./pds-call.ts";

export const PROFILE_COLLECTION = "sh.unset.profile";
export const PROFILE_RKEY = "self";

export type StoredRecord = { readonly value: unknown; readonly cid: string | null };

type PdsCall = <T>(
  ctx: PdsContext | null,
  did: Did,
  op: (xrpc: Agent) => Promise<T>,
  opts: { readonly idempotent: boolean },
) => Promise<PdsResult<T>>;

function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { error?: unknown }).error === "RecordNotFound";
}

export function loadProfileRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
): Promise<PdsResult<StoredRecord | null>> {
  return pdsCall(
    ctx,
    did,
    async (agent) => {
      try {
        const { data } = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection: PROFILE_COLLECTION,
          rkey: PROFILE_RKEY,
        });
        return { value: data.value, cid: data.cid ?? null };
      } catch (error: unknown) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    },
    { idempotent: true },
  );
}
