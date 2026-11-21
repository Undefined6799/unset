// P3.05s (consumer.ts): the reader's frames reach the index store as its own frames; a frame that keeps failing is
// dead-lettered after MAX_ATTEMPTS, a database outage never counts, and an account frame is never dead-lettered.
import type { RepoFrame } from "@unset/infrastructure-firehose";
import type { IndexFrame, IndexStore } from "@unset/infrastructure-postgres";
import { describe, expect, test } from "vitest";
import { indexConsumer, MAX_ATTEMPTS } from "./consumer.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const T0 = new Date("2026-11-18T00:00:00Z");
const commitFrame = (seq: number): RepoFrame => ({ kind: "repoCommit", seq, did: DID, rev: "3l", changes: [] });
const accountFrame: RepoFrame = { kind: "account", seq: 5, did: DID, active: false, status: "takendown" };
const sqlError = (code: string) => Object.assign(new Error("refused"), { code });

function recordingStore(fail: (frame: IndexFrame) => Error | null = () => null) {
  const applied: IndexFrame[] = [];
  const dead: { frame: IndexFrame; attempts: number; firstSeen: Date }[] = [];
  const store: IndexStore = {
    cursor: async () => 4,
    apply: async (frame) => {
      const error = fail(frame);
      if (error !== null) throw error;
      applied.push(frame);
    },
    missedEvents: async () => undefined,
    deadLetter: async (frame, attempts, firstSeen) => {
      dead.push({ frame, attempts, firstSeen });
    },
    health: async () => ({
      cursor: 4,
      counters: {} as never,
      deadLetters: dead.length,
      deletionsNotErased: 0,
      jobs: {},
    }),
  };
  return { store, applied, dead };
}

async function applyTimes(apply: (frame: RepoFrame) => Promise<void>, frame: RepoFrame, times: number) {
  const outcomes: string[] = [];
  for (let i = 0; i < times; i += 1)
    outcomes.push(
      await apply(frame).then(
        () => "ok",
        () => "threw",
      ),
    );
  return outcomes;
}

describe("indexConsumer", () => {
  test("indexer.frames_reach_the_store", async () => {
    const { store, applied } = recordingStore();
    const consumer = indexConsumer(store);
    const changes = [{ kind: "delete", collection: "sh.unset.card", rkey: "3jzfcijpj2z2a" }] as const;
    await consumer.apply({ kind: "repoCommit", seq: 5, did: DID, rev: "3l", changes });
    await consumer.apply({ kind: "identity", seq: 6, did: DID });
    await consumer.apply({ kind: "sync", seq: 7, did: DID, rev: "3m" });
    await consumer.apply({ ...accountFrame, seq: 8 });
    expect(applied).toEqual([
      { kind: "repoCommit", seq: 5, did: DID, rev: "3l", changes },
      { kind: "identity", seq: 6, did: DID },
      { kind: "sync", seq: 7, did: DID },
      { kind: "account", seq: 8, did: DID, active: false, status: "takendown" },
    ]);
    expect(await consumer.cursor()).toBe(4);
  });

  test("indexer.poison_frame_is_dead_lettered_after_max_attempts", async () => {
    const { store, dead } = recordingStore((frame) => (frame.seq === 5 ? sqlError("22P05") : null));
    const consumer = indexConsumer(store, () => T0);
    const outcomes = await applyTimes(consumer.apply, commitFrame(5), MAX_ATTEMPTS);
    expect(outcomes).toEqual([...Array(MAX_ATTEMPTS - 1).fill("threw"), "ok"]);
    expect(dead).toEqual([{ frame: { ...commitFrame(5) }, attempts: MAX_ATTEMPTS, firstSeen: T0 }]);
    expect(consumer.health()).toEqual({ failingSeq: null, attempts: 0 });
  });

  test("indexer.failing_frame_shows_on_health", async () => {
    const { store } = recordingStore(() => sqlError("22P05"));
    const consumer = indexConsumer(store);
    await applyTimes(consumer.apply, commitFrame(5), 2);
    expect(consumer.health()).toEqual({ failingSeq: 5, attempts: 2 });
  });

  test("indexer.database_outage_never_counts", async () => {
    const { store, dead } = recordingStore(() => sqlError("08006"));
    const consumer = indexConsumer(store);
    expect(await applyTimes(consumer.apply, commitFrame(5), MAX_ATTEMPTS * 2)).not.toContain("ok");
    expect(dead).toEqual([]);
    expect(consumer.health()).toEqual({ failingSeq: null, attempts: 0 });
  });

  test("indexer.outage_wrapped_with_a_failed_rollback_never_counts", async () => {
    const wrapped = new AggregateError([sqlError("08006"), sqlError("08003")], "transaction failed");
    const { store, dead } = recordingStore(() => wrapped);
    const consumer = indexConsumer(store);
    await applyTimes(consumer.apply, commitFrame(5), MAX_ATTEMPTS * 2);
    expect(dead).toEqual([]);
    expect(consumer.health()).toEqual({ failingSeq: null, attempts: 0 });
  });

  test("indexer.account_frame_is_never_dead_lettered", async () => {
    const { store, dead } = recordingStore(() => sqlError("22P05"));
    const consumer = indexConsumer(store);
    expect(await applyTimes(consumer.apply, accountFrame, MAX_ATTEMPTS * 2)).not.toContain("ok");
    expect(dead).toEqual([]);
    expect(consumer.health()).toEqual({ failingSeq: 5, attempts: MAX_ATTEMPTS * 2 });
  });

  test("indexer.another_frame_restarts_the_count", async () => {
    const { store, dead } = recordingStore((frame) => (frame.seq <= 6 ? sqlError("22P05") : null));
    const consumer = indexConsumer(store);
    await applyTimes(consumer.apply, commitFrame(5), MAX_ATTEMPTS - 1);
    await applyTimes(consumer.apply, commitFrame(6), 1);
    expect(dead).toEqual([]);
    expect(consumer.health()).toEqual({ failingSeq: 6, attempts: 1 });
  });
});
