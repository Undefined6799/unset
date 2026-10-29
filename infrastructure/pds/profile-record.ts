// The member's sh.unset.profile record (Alex 2026-10-23: the profile page), read from and written to their own repo
// over pdsCall.
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

function isXrpcError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && (error as { error?: unknown }).error === name;
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
        if (isXrpcError(error, "RecordNotFound")) return null;
        throw error;
      }
    },
    { idempotent: true },
  );
}

export type BuiltRecord<C extends string> =
  | { readonly ok: true; readonly record: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: C };

export type SaveOutcome<C extends string> =
  | { readonly kind: "saved" }
  | { readonly kind: "refused"; readonly code: C }
  /** The record changed between our read and our write (another tab or client); nothing was written. */
  | { readonly kind: "conflict" };

/**
 * Reads the stored record, lets `build` make the new one from it, and writes it back with `swapRecord` set to the CID
 * it read, so a change made in between is a conflict rather than lost (DA-4: compare-and-swap at the PDS;
 * https://atproto.com/specs/repository and com.atproto.repo.putRecord `swapRecord`, InvalidSwapError in @atproto/api
 * 0.27.0). A first profile swaps on null, which the PDS reads as "must not exist yet" (putRecord's swapRecord is
 * nullable: @atproto/lex-client dist/lexicons/com/atproto/repo/putRecord.defs.js:15), so two first saves cannot
 * overwrite each other. The write is not retried (not idempotent).
 */
export async function saveProfileRecord<C extends string>(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  build: (existing: unknown) => BuiltRecord<C>,
): Promise<PdsResult<SaveOutcome<C>>> {
  const stored = await loadProfileRecord(pdsCall, ctx, did);
  if (stored.kind !== "ok") return stored;
  const built = build(stored.value === null ? null : stored.value.value);
  if (!built.ok) return { kind: "ok", value: { kind: "refused", code: built.code } };
  const swap = stored.value?.cid ?? null;
  return pdsCall(
    ctx,
    did,
    async (agent): Promise<SaveOutcome<C>> => {
      try {
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: PROFILE_COLLECTION,
          rkey: PROFILE_RKEY,
          record: { ...built.record },
          swapRecord: swap,
        });
        return { kind: "saved" };
      } catch (error: unknown) {
        if (isXrpcError(error, "InvalidSwap")) return { kind: "conflict" };
        throw error;
      }
    },
    { idempotent: false },
  );
}
