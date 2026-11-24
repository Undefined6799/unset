// One record in the member's own repo, read and written over pdsCall: the profile (profile-record.ts) and each card
// (card-records.ts). A repo without the record answers RecordNotFound (@atproto/api 0.27.0 com.atproto.repo.getRecord,
// RecordNotFoundError), which is not a failure. Values are returned unparsed; the owning domain reads them.
import type { Agent } from "@atproto/api";
import type { Did } from "@unset/domains-identity";
import type { PdsContext, PdsResult } from "./pds-call.ts";

export type RecordAddress = { readonly collection: string; readonly rkey: string };
export type StoredRecord = { readonly value: unknown; readonly cid: string | null };

export type PdsCall = <T>(
  ctx: PdsContext | null,
  did: Did,
  op: (xrpc: Agent) => Promise<T>,
  opts: { readonly idempotent: boolean; readonly timeoutMs?: number },
) => Promise<PdsResult<T>>;

export function isXrpcError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && (error as { error?: unknown }).error === name;
}

export function loadRecord(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  at: RecordAddress,
): Promise<PdsResult<StoredRecord | null>> {
  return pdsCall(ctx, did, (agent) => getRecord(agent, did, at), { idempotent: true });
}

/**
 * Two records of the same repo in one PDS call, so the session is restored once for both (the query budget counts
 * each restore's grant reads: tests/integration/web/query-budget.test.ts). Either both are read or the call fails.
 */
export function loadRecordPair(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  first: RecordAddress,
  second: RecordAddress,
): Promise<PdsResult<readonly [StoredRecord | null, StoredRecord | null]>> {
  return pdsCall(
    ctx,
    did,
    async (agent) => [await getRecord(agent, did, first), await getRecord(agent, did, second)] as const,
    { idempotent: true },
  );
}

async function getRecord(agent: Agent, did: Did, at: RecordAddress): Promise<StoredRecord | null> {
  try {
    const { data } = await agent.com.atproto.repo.getRecord({ repo: did, collection: at.collection, rkey: at.rkey });
    return { value: data.value, cid: data.cid ?? null };
  } catch (error: unknown) {
    if (isXrpcError(error, "RecordNotFound")) return null;
    throw error;
  }
}

export type BuiltRecord<C extends string> =
  | { readonly ok: true; readonly record: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: C };

export type SaveOutcome<C extends string> =
  /** `rev` is the commit's revision (a TID, so revisions sort by time), absent when the PDS wrote nothing new. */
  | { readonly kind: "saved"; readonly rev?: string }
  | { readonly kind: "refused"; readonly code: C }
  /** The record changed between our read and our write (another tab or client); nothing was written. */
  | { readonly kind: "conflict" };

/**
 * Reads the stored record, lets `build` make the new one from it, and writes it back with `swapRecord` set to the CID
 * it read, so a change made in between is a conflict rather than lost (DA-4: compare-and-swap at the PDS;
 * https://atproto.com/specs/repository and com.atproto.repo.putRecord `swapRecord`, InvalidSwapError in @atproto/api
 * 0.27.0). A first record swaps on null, which the PDS reads as "must not exist yet" (putRecord's swapRecord is
 * nullable: @atproto/lex-client dist/lexicons/com/atproto/repo/putRecord.defs.js:15), so two first saves cannot
 * overwrite each other. The write is not retried (not idempotent).
 */
export async function saveRecord<C extends string>(
  pdsCall: PdsCall,
  ctx: PdsContext | null,
  did: Did,
  at: RecordAddress,
  build: (existing: unknown) => BuiltRecord<C>,
): Promise<PdsResult<SaveOutcome<C>>> {
  const stored = await loadRecord(pdsCall, ctx, did, at);
  if (stored.kind !== "ok") return stored;
  const built = build(stored.value === null ? null : stored.value.value);
  if (!built.ok) return { kind: "ok", value: { kind: "refused", code: built.code } };
  const swap = stored.value?.cid ?? null;
  return pdsCall(
    ctx,
    did,
    async (agent): Promise<SaveOutcome<C>> => {
      try {
        const { data } = await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: at.collection,
          rkey: at.rkey,
          record: { ...built.record },
          swapRecord: swap,
        });
        // @atproto/pds 0.5.51 putRecord.ts answers no commit when the record was already exactly this.
        return data.commit === undefined ? { kind: "saved" } : { kind: "saved", rev: data.commit.rev };
      } catch (error: unknown) {
        if (isXrpcError(error, "InvalidSwap")) return { kind: "conflict" };
        throw error;
      }
    },
    { idempotent: false },
  );
}
