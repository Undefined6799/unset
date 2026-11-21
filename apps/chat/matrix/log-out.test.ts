// How Log out waits for the key backup (ADR 0083 decision 5; build plan step 4): only while an upload may be pending,
// and then until the SDK reports nothing left, or a short deadline. The watch is fed what matrix-js-sdk 43.0.0 says in
// public (CryptoEvent.KeyBackupStatus and KeyBackupSessionsRemaining, src/rust-crypto/backup.ts:407, 464, 506; a new
// room key, src/sync.ts:2041-2093, src/models/room.ts:2846); client.ts wires those events to it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BACKUP_WAIT_MS, watchBackup } from "./log-out.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The outcome if the wait has ended by now, without moving the clock. */
async function settledNow<T>(wait: Promise<T>): Promise<T | "still waiting"> {
  return Promise.race([wait, Promise.resolve().then(() => "still waiting" as const)]);
}

describe("watchBackup", () => {
  test("chat.backup_wait_idle: with no upload pending, Log out does not wait at all", async () => {
    const watch = watchBackup();
    expect(await settledNow(watch.settled(BACKUP_WAIT_MS))).toBe("idle");
  });

  test("chat.backup_wait_idle_after_drain: once the backup reported nothing left, Log out does not wait", async () => {
    const watch = watchBackup();
    watch.enabled(true);
    watch.remaining(4);
    watch.remaining(0);
    expect(await settledNow(watch.settled(BACKUP_WAIT_MS))).toBe("idle");
  });

  test("chat.backup_wait_zero: a pending upload is waited for until the backup reports nothing left", async () => {
    const watch = watchBackup();
    watch.enabled(true); // the SDK starts its upload loop as it enables the backup (backup.ts:398-409)
    const wait = watch.settled(60_000);
    expect(await settledNow(wait)).toBe("still waiting");
    watch.remaining(3);
    expect(await settledNow(wait)).toBe("still waiting");
    watch.remaining(0);
    expect(await wait).toBe("settled");
  });

  test("chat.backup_wait_new_key: a room key made after the last drain is waited for again", async () => {
    const watch = watchBackup();
    watch.enabled(true);
    watch.remaining(0);
    watch.keyMade();
    const wait = watch.settled(60_000);
    expect(await settledNow(wait)).toBe("still waiting");
    watch.remaining(0);
    expect(await wait).toBe("settled");
  });

  test("chat.backup_wait_disabled: a backup turned off has nothing left to upload", async () => {
    const watch = watchBackup();
    watch.enabled(true);
    const wait = watch.settled(60_000);
    watch.enabled(false);
    expect(await wait).toBe("settled");
  });

  test("chat.backup_wait_deadline: with no report of zero it gives up at the deadline", async () => {
    const watch = watchBackup();
    watch.enabled(true);
    const wait = watch.settled(1000);
    watch.remaining(2);
    vi.advanceTimersByTime(1000);
    expect(await wait).toBe("deadline");
  });

  test("chat.backup_wait_bounded: the wait outlasts the SDK's own start delay but stays short", () => {
    // RustBackupManager.maxBackupLoopStartDelayMillis is 10 000 (src/rust-crypto/backup.ts:70).
    expect(BACKUP_WAIT_MS).toBeGreaterThan(10_000);
    expect(BACKUP_WAIT_MS).toBeLessThanOrEqual(20_000);
  });
});
