// Log out's wait for the key backup (ADR 0083 decision 5; build plan step 4, "Listen for
// CryptoEvent.KeyBackupSessionsRemaining until it reports 0, with a short deadline"), taken only while an upload may be
// pending. matrix-js-sdk 43.0.0 has no public call that says so (the loop's flag and the key counts are private:
// src/rust-crypto/backup.ts:88, 498), so the watch follows what the SDK does say, from the client's start:
//   - KeyBackupStatus true: the backup was enabled and its upload loop starts (backup.ts:398-409); false: it stopped
//     (:423-427), and nothing more is uploaded.
//   - KeyBackupSessionsRemaining n: the loop's count, and 0 when it has nothing left and ends (:464, 506).
//   - a new room key (client.ts wires a to-device room key, src/sync.ts:2041-2093, and this browser's own send, which
//     makes one, src/models/room.ts:2846): the SDK restarts the loop for it (src/rust-crypto/rust-crypto.ts:1986-1991,
//     backup.ts:417-421).
// The loop waits up to 10 s before it starts (RustBackupManager.maxBackupLoopStartDelayMillis, :70), and keys took 4 to
// 15 s to reach the backup in the 2026-11-20 spike, hence the deadline. A loop that fails keeps retrying without a 0,
// so the deadline still bounds the wait; a key made in its last seconds is then the only thing that can be lost, as
// PLAN §5.6 accepts.

export const BACKUP_WAIT_MS = 15_000;

export type BackupWatch = {
  /** CryptoEvent.KeyBackupSessionsRemaining. */
  readonly remaining: (count: number) => void;
  /** CryptoEvent.KeyBackupStatus. */
  readonly enabled: (on: boolean) => void;
  /** A room key this browser has to back up was just made or received. */
  readonly keyMade: () => void;
  /** "idle" at once when nothing is pending; else "settled" when the backup has caught up, or "deadline" after `ms`. */
  readonly settled: (ms: number) => Promise<"idle" | "settled" | "deadline">;
};

/** A watch on this client's key backup, fed by its events from before the client starts. */
export function watchBackup(): BackupWatch {
  let pending = false;
  const waiting = new Set<() => void>();
  const set = (next: boolean) => {
    pending = next;
    if (pending) return;
    for (const wake of waiting) wake();
  };
  return {
    remaining: (count) => set(count > 0),
    enabled: (on) => set(on),
    keyMade: () => set(true),
    settled: (ms) => {
      if (!pending) return Promise.resolve("idle");
      return new Promise((resolve) => {
        const done = (outcome: "settled" | "deadline") => {
          clearTimeout(timer);
          waiting.delete(wake);
          resolve(outcome);
        };
        const wake = () => done("settled");
        const timer = setTimeout(() => done("deadline"), ms);
        waiting.add(wake);
      });
    },
  };
}
