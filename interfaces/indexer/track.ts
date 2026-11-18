// One pass of the track loop and one of the backfill loop (book P3.02s, P3.05s; ADR 0052 decisions 3 and 5). Network
// work (resolving a DID, reading a repo) runs here, before the store's short transaction (rule DA-4). The process that
// runs these passes on a timer comes with its compose service (P3.05s PR 3), and starts the stream reader before
// the first backfill pass, so a commit made while a repo is read is not missed: it either is in the repo or arrives
// on the stream after it, and the rev guards apply the two in either order.

import { INDEXED_COLLECTIONS } from "@unset/domains-profile";
import type { RepoReader } from "@unset/infrastructure-firehose";
import { RepoReadError } from "@unset/infrastructure-firehose";
import type { TrackStore } from "@unset/infrastructure-postgres";

export const TRACK_BATCH = 100;
export const BACKFILL_BATCH = 10;

export type TrackDeps = {
  readonly store: TrackStore;
  /**
   * The PDS origin the DID's document names, read fresh (domains/identity's resolver on net-guard), or null when it
   * names none. A throw means the DID could not be resolved now: its request stays queued for the next pass.
   */
  readonly pdsOf: (did: string, signal: AbortSignal) => Promise<URL | null>;
  /** Our PDS's public origin, PDS_PUBLIC_URL: a DID is ours when its document names exactly this origin. */
  readonly ownPds: URL;
  readonly timeoutMs: number;
};

export type TrackPass = { readonly tracked: number; readonly dropped: number; readonly unresolved: number };

/** Settles each queued track request whose DID resolves; one that does not stays for the next pass. */
export async function trackPass(deps: TrackDeps): Promise<TrackPass> {
  let tracked = 0;
  let dropped = 0;
  let unresolved = 0;
  for (const did of await deps.store.pendingTracks(TRACK_BATCH)) {
    const pds = await deps.pdsOf(did, AbortSignal.timeout(deps.timeoutMs)).catch(() => undefined);
    if (pds === undefined) {
      unresolved += 1;
      continue;
    }
    const outcome = await deps.store.track(did, pds !== null && pds.origin === deps.ownPds.origin);
    if (outcome === "tracked") tracked += 1;
    else dropped += 1;
  }
  return { tracked, dropped, unresolved };
}

export type BackfillDeps = {
  readonly store: TrackStore;
  readonly readRepo: RepoReader;
  readonly timeoutMs: number;
};

export type BackfillPass = { readonly applied: number; readonly failed: number };

/** Reads and applies each due backfill; a failure backs that job off and the pass goes on with the next. */
export async function backfillPass(deps: BackfillDeps): Promise<BackfillPass> {
  let applied = 0;
  let failed = 0;
  for (const job of await deps.store.dueBackfills(BACKFILL_BATCH)) {
    try {
      const snapshot = await deps.readRepo(job.did, AbortSignal.timeout(deps.timeoutMs));
      await deps.store.applySnapshot(job.did, snapshot.rev, snapshot.records);
      applied += 1;
    } catch (error) {
      failed += 1;
      const gone = error instanceof RepoReadError && error.reason === "not_found";
      await deps.store.backfillFailed(job, gone ? "gone" : "failed");
    }
  }
  return { applied, failed };
}

/** The collections a backfill asks the repo reader for. */
export const BACKFILL_COLLECTIONS: readonly string[] = INDEXED_COLLECTIONS;
