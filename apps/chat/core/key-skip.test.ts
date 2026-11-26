// "Skip for now" on the unlock card (Alex 2026-11-23: without the key a member still uses chat and sees new
// messages, only the older ones stay locked), as Element's "I'll verify later" does (element-web v1.12.35
// apps/web/src/stores/SetupEncryptionStore.ts:197-210). The choice is this browser's, for this account, and goes
// with Log out like the other local choices.
import { describe, expect, test } from "vitest";
import { forgetKeySkip, keySkipped, skipKey } from "./key-skip.ts";

const ME = "@uaaaaaaaaaaaaaaaaaaaa:unset.cc";
const OTHER = "@ubbbbbbbbbbbbbbbbbbbb:unset.cc";

function memory() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    keys: () => [...items.keys()],
  };
}

describe("key skip", () => {
  test("chat.key_skip_kept: a skip is remembered for this account only, and Log out forgets it", () => {
    const storage = memory();
    expect(keySkipped(storage, ME)).toBe(false);
    skipKey(storage, ME);
    expect(keySkipped(storage, ME)).toBe(true);
    expect(keySkipped(storage, OTHER)).toBe(false);
    expect(storage.keys().every((k) => k.startsWith("unset-chat:"))).toBe(true);
    forgetKeySkip(storage, ME);
    expect(keySkipped(storage, ME)).toBe(false);
  });

  test("chat.key_skip_storage_refused: storage that throws counts as not skipped, and a skip still returns", () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(keySkipped(refusing, ME)).toBe(false);
    expect(() => skipKey(refusing, ME)).not.toThrow();
    expect(() => forgetKeySkip(refusing, ME)).not.toThrow();
  });
});
