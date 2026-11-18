// P3.05s PR 2b (track.ts): a track pass routes each DID by its PDS and keeps an unresolved one queued; a backfill pass
// applies what the repo reader returns and backs a failed job off without stopping the pass.
import { RepoReadError, type RepoReader } from "@unset/infrastructure-firehose";
import type { BackfillFailure, BackfillJob, TrackStore } from "@unset/infrastructure-postgres";
import { describe, expect, test } from "vitest";
import { backfillPass, MAX_TRACK_ATTEMPTS, type TrackRetries, trackPass } from "./track.ts";

const OWN = new URL("https://unset.ac");
const OURS = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const THEIRS = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const LOST = "did:plc:cccccccccccccccccccccccc";

function fakeStore(pending: string[], due: BackfillJob[]) {
  const settled: [string, boolean][] = [];
  const applied: [string, string][] = [];
  const failed: [string, BackfillFailure][] = [];
  const unresolved: string[] = [];
  const store: TrackStore = {
    pendingTracks: async (_limit, skip) => pending.filter((did) => !skip.includes(did) && !unresolved.includes(did)),
    dropUnresolved: async (did) => {
      unresolved.push(did);
    },
    track: async (did, hosted) => {
      settled.push([did, hosted]);
      return hosted ? "tracked" : "foreign";
    },
    dueBackfills: async () => due,
    applySnapshot: async (job, rev) => {
      applied.push([job.did, rev]);
    },
    backfillFailed: async (job, failure) => {
      failed.push([job.did, failure]);
    },
  };
  return { store, settled, applied, failed, unresolved };
}

const retries = () => ({ retries: new Map() as TrackRetries, now: () => 0 });

describe("trackPass", () => {
  test("indexer.tracks_only_dids_whose_pds_is_ours", async () => {
    const fake = fakeStore([OURS, THEIRS, LOST], []);
    const pdsOf = async (did: string) => {
      if (did === LOST) throw new Error("unresolvable");
      return did === OURS ? new URL("https://unset.ac/") : new URL("https://bsky.social");
    };
    const pass = await trackPass({ store: fake.store, pdsOf, ownPds: OWN, timeoutMs: 1000, ...retries() });
    expect(fake.settled).toEqual([
      [OURS, true],
      [THEIRS, false],
    ]);
    expect(pass).toEqual({ tracked: 1, dropped: 1, unresolved: 1 });
  });

  test("indexer.a_did_naming_no_pds_is_not_ours", async () => {
    const fake = fakeStore([OURS], []);
    await trackPass({ store: fake.store, pdsOf: async () => null, ownPds: OWN, timeoutMs: 1000, ...retries() });
    expect(fake.settled).toEqual([[OURS, false]]);
  });

  test("indexer.unresolved_did_backs_off_then_is_dropped", async () => {
    // A DID that never resolves must not hold the oldest places in the queue for ever: it waits longer each time, so
    // newer requests are reached, and is dropped and counted after MAX_TRACK_ATTEMPTS.
    const fake = fakeStore([LOST, OURS], []);
    let clock = 0;
    const deps = {
      store: fake.store,
      pdsOf: async (did: string) => {
        if (did === LOST) throw new Error("unresolvable");
        return OWN;
      },
      ownPds: OWN,
      timeoutMs: 1000,
      retries: new Map() as TrackRetries,
      now: () => clock,
    };
    expect(await trackPass(deps)).toEqual({ tracked: 1, dropped: 0, unresolved: 1 });
    expect(await trackPass(deps)).toEqual({ tracked: 1, dropped: 0, unresolved: 0 }); // LOST waits its turn
    for (let attempt = 1; attempt < MAX_TRACK_ATTEMPTS; attempt += 1) {
      clock += 24 * 3600 * 1000;
      await trackPass(deps);
    }
    expect(fake.unresolved).toEqual([LOST]);
    expect(deps.retries.size).toBe(0);
  });
});

describe("backfillPass", () => {
  test("indexer.backfill_applies_and_backs_off_per_job", async () => {
    const fake = fakeStore(
      [],
      [
        { did: OURS, attempts: 0, claim: "c" },
        { did: THEIRS, attempts: 2, claim: "c" },
        { did: LOST, attempts: 0, claim: "c" },
      ],
    );
    const readRepo: RepoReader = async (did) => {
      if (did === THEIRS) throw new RepoReadError("unverified");
      if (did === LOST) throw new RepoReadError("not_found");
      return { rev: "3l", records: [] };
    };
    const pass = await backfillPass({ store: fake.store, readRepo, timeoutMs: 1000 });
    expect(fake.applied).toEqual([[OURS, "3l"]]);
    expect(fake.failed).toEqual([
      [THEIRS, "failed"],
      [LOST, "gone"],
    ]);
    expect(pass).toEqual({ applied: 1, failed: 2 });
  });
});
