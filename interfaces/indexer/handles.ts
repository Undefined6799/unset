// The handle rule (book P3.08s; plan §5.2 "handles in events are hints only"). The handle we store for a DID is the
// one verifyHandle confirms in both directions, read fresh: https://atproto.com/specs/handle ("Handle Resolution",
// bidirectional check). A handle under one of our hosted suffixes needs more, because our PDS is the only authority
// for those names: the DID's document must name our PDS, our PDS must hold an active repo for it
// (com.atproto.sync.getRepoStatus), and our PDS must map the handle back to the same DID
// (com.atproto.identity.resolveHandle). Without those, anyone could point a DNS-less claim at one of our names.
//
// Three outcomes. `invalid` clears the stored handle. `unresolved` keeps what is stored, because an outage on our
// side or theirs says nothing about the handle. `verified` names the handle to store.
import type { HandleVerdict } from "@unset/domains-identity";
import type { HandleOnPds, RepoStatus } from "@unset/infrastructure-firehose";
import type { HandleStore } from "@unset/infrastructure-postgres";
import { withDeadline } from "./track.ts";

export type HandleCheck =
  | { readonly status: "verified"; readonly handle: string }
  | { readonly status: "invalid" }
  | { readonly status: "unresolved" };

export type HandleCheckDeps = {
  /** domains/identity's verifier, asked fresh; it never throws. */
  readonly verifyHandle: (did: string, signal: AbortSignal) => Promise<HandleVerdict>;
  /** The PDS origin the DID's document names, read fresh, or null when it names none. May throw on an outage. */
  readonly pdsOf: (did: string, signal: AbortSignal) => Promise<URL | null>;
  readonly readStatus: (did: string, signal: AbortSignal) => Promise<RepoStatus>;
  readonly resolveOnPds: (handle: string, signal: AbortSignal) => Promise<HandleOnPds>;
  /** PDS_PUBLIC_URL */
  readonly ownPds: URL;
  /** HOSTED_HANDLE_SUFFIXES, each starting with a dot, lower case. */
  readonly hostedSuffixes: readonly string[];
};

const INVALID: HandleCheck = { status: "invalid" };
const UNRESOLVED: HandleCheck = { status: "unresolved" };

/** True when the handle is a name under one of our suffixes, on a label boundary; the bare suffix is not a handle. */
export function isHostedHandle(handle: string, suffixes: readonly string[]): boolean {
  const lower = handle.toLowerCase();
  return suffixes.some((suffix) => lower.endsWith(suffix) && lower.length > suffix.length);
}

export async function checkHandle(deps: HandleCheckDeps, did: string, signal: AbortSignal): Promise<HandleCheck> {
  const verdict = await deps.verifyHandle(did, signal);
  if (verdict.status === "unavailable") return UNRESOLVED;
  if (verdict.status === "invalid") return INVALID;
  const verified: HandleCheck = { status: "verified", handle: verdict.handle };
  if (!isHostedHandle(verdict.handle, deps.hostedSuffixes)) return verified;
  try {
    return await checkHostedHandle(deps, did, verdict.handle, signal, verified);
  } catch {
    return UNRESOLVED;
  }
}

/** The three checks only our PDS can answer, in order; any outage leaves the stored handle alone. */
async function checkHostedHandle(
  deps: HandleCheckDeps,
  did: string,
  handle: string,
  signal: AbortSignal,
  verified: HandleCheck,
): Promise<HandleCheck> {
  const pds = await deps.pdsOf(did, signal);
  if (pds === null || pds.origin !== deps.ownPds.origin) return INVALID;
  const status = await deps.readStatus(did, signal);
  if (status.kind === "unavailable") return UNRESOLVED;
  if (status.kind !== "active") return INVALID;
  const onPds = await deps.resolveOnPds(handle, signal);
  if (onPds.kind === "unavailable") return UNRESOLVED;
  return onPds.kind === "did" && onPds.did === did ? verified : INVALID;
}

/** Checks per pass (book P3.06's batch of 20, as the other passes). */
export const HANDLE_BATCH = 20;
/** The sweep for accounts never checked or checked too long ago runs at most this often (book P3.08: 10 minutes). */
export const HANDLE_SWEEP_MS = 10 * 60 * 1000;

export type HandlePassDeps = {
  readonly store: Pick<HandleStore, "queueStale" | "dueChecks" | "checked">;
  readonly check: HandleCheckDeps;
  /** One check's whole deadline: up to four reads (the DID document, verifyHandle, repo status, resolveHandle). */
  readonly timeoutMs: number;
  /** HANDLE_RECHECK_S: a verified handle is checked again after this. */
  readonly recheckSeconds: number;
  /** When the sweep last ran, kept by the caller across passes. */
  readonly sweep: { lastAt: number | null };
  readonly now: () => number;
  /** The process's stop: a check it cuts short writes nothing, and its job comes back after the lease. */
  readonly signal: AbortSignal;
};

export type HandlePass = {
  readonly queued: number;
  readonly verified: number;
  readonly invalid: number;
  readonly unresolved: number;
  readonly failed: number;
};

/** Sweeps when due, then checks each claimed job over the network and writes its outcome in a short transaction. */
export async function handlePass(deps: HandlePassDeps): Promise<HandlePass> {
  const counts = { queued: 0, verified: 0, invalid: 0, unresolved: 0, failed: 0 };
  if (deps.sweep.lastAt === null || deps.now() - deps.sweep.lastAt >= HANDLE_SWEEP_MS) {
    counts.queued = await deps.store.queueStale(HANDLE_BATCH * 30, deps.recheckSeconds);
    deps.sweep.lastAt = deps.now();
  }
  for (const job of await deps.store.dueChecks(HANDLE_BATCH)) {
    if (deps.signal.aborted) break;
    const outcome = await checkHandle(deps.check, job.did, withDeadline(deps.signal, deps.timeoutMs));
    if (deps.signal.aborted) break;
    try {
      await deps.store.checked(job, outcome);
      counts[outcome.status] += 1;
    } catch {
      counts.failed += 1; // the job stays claimed until its lease ends, then is checked again
    }
  }
  return counts;
}
