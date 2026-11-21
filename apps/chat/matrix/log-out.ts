// Log out's wait for the key backup (ADR 0083 decision 5; build plan step 4, "Listen for
// CryptoEvent.KeyBackupSessionsRemaining until it reports 0, with a short deadline"). matrix-js-sdk 43.0.0 emits the
// count while its backup loop uploads and 0 when nothing is left (src/rust-crypto/backup.ts:464, 506); the loop waits
// up to 10 s before it starts (RustBackupManager.maxBackupLoopStartDelayMillis, :70), and keys took 4 to 15 s to reach
// the backup in the 2026-11-20 spike. The SDK has no public call for the count itself, so an idle loop means the
// whole deadline: a key made in the last seconds is then the only thing that can be lost, as PLAN §5.6 accepts.
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/index.js";

export const BACKUP_WAIT_MS = 15_000;

type Remaining = (remaining: number) => void;
/** The SDK client's emitter, by shape: only the backup event is listened to. */
export type BackupEvents = {
  on(event: CryptoEvent.KeyBackupSessionsRemaining, listener: Remaining): unknown;
  off(event: CryptoEvent.KeyBackupSessionsRemaining, listener: Remaining): unknown;
};

/** Resolves "settled" when the backup reports 0 left, or "deadline" after `ms`; it stops listening either way. */
export function backupSettled(events: BackupEvents, ms: number): Promise<"settled" | "deadline"> {
  return new Promise((resolve) => {
    const done = (outcome: "settled" | "deadline") => {
      clearTimeout(timer);
      events.off(CryptoEvent.KeyBackupSessionsRemaining, onRemaining);
      resolve(outcome);
    };
    const onRemaining: Remaining = (remaining) => remaining === 0 && done("settled");
    const timer = setTimeout(() => done("deadline"), ms);
    events.on(CryptoEvent.KeyBackupSessionsRemaining, onRemaining);
  });
}
