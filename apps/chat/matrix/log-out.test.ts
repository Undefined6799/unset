// How Log out waits for the key backup (ADR 0083 decision 5; build plan step 4): until the SDK reports no session left
// to back up, or a short deadline. The event source is a stand-in with the SDK's on/off shape; the real event is
// matrix-js-sdk 43.0.0 CryptoEvent.KeyBackupSessionsRemaining (src/rust-crypto/backup.ts:464, 506).
import { describe, expect, test, vi } from "vitest";
import { BACKUP_WAIT_MS, backupSettled } from "./log-out.ts";

function source() {
  const listeners = new Set<(remaining: number) => void>();
  return {
    on: (_event: string, listener: (remaining: number) => void) => void listeners.add(listener),
    off: (_event: string, listener: (remaining: number) => void) => void listeners.delete(listener),
    emit: (remaining: number) => {
      for (const listener of listeners) listener(remaining);
    },
    listeners,
  };
}

describe("backupSettled", () => {
  test("chat.backup_wait_zero: it ends when the backup reports nothing left, and stops listening", async () => {
    const s = source();
    const wait = backupSettled(s, 60_000);
    s.emit(3);
    s.emit(0);
    expect(await wait).toBe("settled");
    expect(s.listeners.size).toBe(0);
  });

  test("chat.backup_wait_deadline: with no report of zero it gives up at the deadline", async () => {
    vi.useFakeTimers();
    try {
      const s = source();
      const wait = backupSettled(s, 1000);
      s.emit(2);
      vi.advanceTimersByTime(1000);
      expect(await wait).toBe("deadline");
      expect(s.listeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("chat.backup_wait_bounded: the wait outlasts the SDK's own start delay but stays short", () => {
    // RustBackupManager.maxBackupLoopStartDelayMillis is 10 000 (src/rust-crypto/backup.ts:70).
    expect(BACKUP_WAIT_MS).toBeGreaterThan(10_000);
    expect(BACKUP_WAIT_MS).toBeLessThanOrEqual(20_000);
  });
});
