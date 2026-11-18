// The indexer's consumer of our PDS's stream (book P3.05s): the reader's frames, applied by the index store. The
// process wiring that starts the reader with it, and serves `health` on the indexer's health endpoint, comes with its
// compose service (P3.05s PR 3).
//
// A frame that keeps failing must not stall every member behind it (book P3.05, "event_failed"): the reader stops
// on a failed apply and redials from the cursor, so the same frame comes back, and after MAX_ATTEMPTS failures of
// the same seq it is dead-lettered, its account queued for a backfill and the cursor moved past it, counted on
// health. A failure that says nothing about the frame (the database unreachable) is never counted. An account frame
// is never dead-lettered (book P3.05: status events hold): skipping one could leave a taken-down account public.
//
// A statement timeout (57014) counts, so under heavy load a frame can be dead-lettered that would have applied later.
// That is safe because the dead letter queues the account's backfill, which rewrites the account from its signed repo
// and removes indexed records the repo no longer holds (P3.05s PR 2b), so a lost delete is undone. The attempts are
// counted in memory: a frame that crashes the process restarts the count with it, and shows as a restart loop on the
// process's health rather than on this count.
import type { FirehoseConsumer, RepoFrame } from "@unset/infrastructure-firehose";
import { type IndexFrame, type IndexStore, isDatabaseUnavailable } from "@unset/infrastructure-postgres";

/** Failures of one frame before it is dead-lettered (book P3.05, `INDEXER_MAX_ATTEMPTS`). */
export const MAX_ATTEMPTS = 5;

/** The frame now failing, if any: its seq and how often, never its DID or content (rule SE-7). */
export type ConsumerHealth = { readonly failingSeq: number | null; readonly attempts: number };

export type IndexConsumer = FirehoseConsumer & { readonly health: () => ConsumerHealth };

export function indexConsumer(store: IndexStore, now: () => Date = () => new Date()): IndexConsumer {
  let failing: { seq: number; attempts: number; firstSeen: Date } | null = null;
  const apply = async (frame: RepoFrame): Promise<void> => {
    const indexed = indexFrame(frame);
    try {
      await store.apply(indexed);
    } catch (error) {
      if (isDatabaseUnavailable(error)) throw error;
      if (failing?.seq !== frame.seq) failing = { seq: frame.seq, attempts: 0, firstSeen: now() };
      failing.attempts += 1;
      if (failing.attempts < MAX_ATTEMPTS || indexed.kind === "account") throw error;
      await store.deadLetter(indexed, failing.attempts, failing.firstSeen);
    }
    failing = null;
  };
  return {
    cursor: store.cursor,
    apply,
    missedEvents: store.missedEvents,
    health: () => ({ failingSeq: failing?.seq ?? null, attempts: failing?.attempts ?? 0 }),
  };
}

function indexFrame(frame: RepoFrame): IndexFrame {
  switch (frame.kind) {
    case "repoCommit":
      return { kind: "repoCommit", seq: frame.seq, did: frame.did, rev: frame.rev, changes: frame.changes };
    case "identity":
      return { kind: "identity", seq: frame.seq, did: frame.did };
    case "sync":
      return { kind: "sync", seq: frame.seq, did: frame.did };
    case "account":
      return { kind: "account", seq: frame.seq, did: frame.did, active: frame.active, status: frame.status };
  }
}
