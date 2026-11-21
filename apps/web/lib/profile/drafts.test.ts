import { describe, expect, test } from "vitest";
import { clearDraft, type DraftStorage, readDraft, writeDraft } from "./drafts.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const V1 = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";

function memory(): DraftStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("device drafts", () => {
  test("a draft is read back for the same member and card, with the version it started from", async () => {
    const storage = memory();
    expect(await writeDraft(storage, DID, "k1", { version: V1, text: "Unsaved words" })).toBe(true);
    expect(await readDraft(storage, DID, "k1")).toEqual({ version: V1, text: "Unsaved words" });
    expect(await readDraft(storage, DID, "k2")).toBeNull();
    expect(await readDraft(storage, OTHER, "k1")).toBeNull();
  });

  test("the stored key names neither the member nor the card", async () => {
    const storage = memory();
    await writeDraft(storage, DID, "k1", { version: V1, text: "x" });
    const [key] = [...storage.items.keys()];
    expect(key).toMatch(/^unset\.draft\.[0-9a-f]{64}$/);
    expect(key).not.toContain(DID);
  });

  // CI webkit on 402dfe8: a reload right after typing kept older words, as each write waited for its key's digest.
  // Once a card's key is known (the page reads every draft when it opens), a write lands before writeDraft returns,
  // so a page that goes away right after it still keeps the words.
  test("a draft written after its card was read is stored at once", async () => {
    const storage = memory();
    await readDraft(storage, DID, "k3");
    void writeDraft(storage, DID, "k3", { version: V1, text: "first" });
    void writeDraft(storage, DID, "k3", { version: V1, text: "last" });
    expect([...storage.items.values()].map((raw) => JSON.parse(raw).text)).toEqual(["last"]);
    void clearDraft(storage, DID, "k3");
    expect(storage.items.size).toBe(0);
  });

  test("a cleared draft is gone", async () => {
    const storage = memory();
    await writeDraft(storage, DID, "k1", { version: V1, text: "x" });
    await clearDraft(storage, DID, "k1");
    expect(await readDraft(storage, DID, "k1")).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  test("anything stored that is not a draft of ours reads as none and is dropped", async () => {
    const storage = memory();
    await writeDraft(storage, DID, "k1", { version: V1, text: "x" });
    const [key] = [...storage.items.keys()];
    for (const bad of ["not json", "{}", '{"v":2,"version":"b","text":"x"}', '{"v":1,"version":1,"text":"x"}']) {
      storage.items.set(key ?? "", bad);
      expect(await readDraft(storage, DID, "k1")).toBeNull();
      expect(storage.items.has(key ?? "")).toBe(false);
    }
  });

  test("a device that refuses to store (full, or storage turned off) loses the draft, not the page", async () => {
    const refusing: DraftStorage = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(await writeDraft(refusing, DID, "k1", { version: V1, text: "x" })).toBe(false);
    expect(await readDraft(refusing, DID, "k1")).toBeNull();
    await expect(clearDraft(refusing, DID, "k1")).resolves.toBeUndefined();
  });
});
