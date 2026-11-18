// P3.05s (consumer.ts): the reader's frames reach the index store as its own frames; an account frame stops the stream.
import type { IndexFrame, IndexStore } from "@unset/infrastructure-postgres";
import { describe, expect, test } from "vitest";
import { AccountFrameUnsupported, indexConsumer } from "./consumer.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";

function recordingStore(): { store: IndexStore; applied: IndexFrame[] } {
  const applied: IndexFrame[] = [];
  const store: IndexStore = {
    cursor: async () => 4,
    apply: async (frame) => {
      applied.push(frame);
    },
    missedEvents: async () => undefined,
  };
  return { store, applied };
}

describe("indexConsumer", () => {
  test("indexer.frames_reach_the_store", async () => {
    const { store, applied } = recordingStore();
    const consumer = indexConsumer(store);
    const changes = [{ kind: "delete", collection: "sh.unset.section", rkey: "3jzfcijpj2z2a" }] as const;
    await consumer.apply({ kind: "repoCommit", seq: 5, did: DID, rev: "3l", changes });
    await consumer.apply({ kind: "identity", seq: 6, did: DID });
    await consumer.apply({ kind: "sync", seq: 7, did: DID, rev: "3m" });
    expect(applied).toEqual([
      { kind: "repoCommit", seq: 5, did: DID, rev: "3l", changes },
      { kind: "identity", seq: 6, did: DID },
      { kind: "sync", seq: 7, did: DID },
    ]);
    expect(await consumer.cursor()).toBe(4);
  });

  test("indexer.account_frame_stops_the_stream", async () => {
    const { store, applied } = recordingStore();
    const frame = { kind: "account", seq: 5, did: DID, active: false, status: "takendown" } as const;
    await expect(indexConsumer(store).apply(frame)).rejects.toBeInstanceOf(AccountFrameUnsupported);
    expect(applied).toEqual([]);
  });
});
