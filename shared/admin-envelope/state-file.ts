// Durable appends for the admin services' state files (pds-admin, chat-admin): each line is written and fsynced before the call returns, so a crash
// cannot lose a line the service has acted on. Synchronous on purpose: the service is tiny, and a line on disk before
// the next await is what makes the replay check race-free (P2.09 step 7).
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * A state file whose on-disk contents can no longer be known: an append failed and cutting it back failed too. The
 * process must stop, so a restart reads the file as it really is (PostgreSQL makes the same call and PANICs on a failed
 * fsync: https://www.postgresql.org/docs/current/runtime-config-error-handling.html, data_sync_retry).
 */
export class DurabilityLost extends Error {}

/**
 * Writes all of `text`. writeSync may write fewer bytes than asked (a full disk, a file-size limit), so it loops, and
 * a write that makes no progress throws: the caller never fsyncs and acts on a line that is not all there.
 */
function writeAll(fd: number, text: string): void {
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset);
    if (written <= 0) throw new Error("short write");
    offset += written;
  }
}

/**
 * Appends one line and fsyncs it. A write or fsync that fails is cut back to the file's old length and that cut is
 * fsynced, so the file is durably as it was and the next line never joins a torn or uncommitted one (a jti merged into
 * a torn line would be lost on reopen; a log record left behind would break the hash chain). The earlier bytes were
 * already fsynced by earlier calls. If the cut fails too, the file's state is unknown: DurabilityLost.
 */
export function appendLine(file: string, line: string): void {
  const created = !existsSync(file);
  const fd = openSync(file, "a", 0o600);
  try {
    const before = fstatSync(fd).size;
    try {
      writeAll(fd, `${line}\n`);
      fsyncSync(fd);
    } catch (error) {
      cutBack(fd, before);
      throw error;
    }
  } finally {
    closeSync(fd);
  }
  if (created) syncDirectory(file);
}

function cutBack(fd: number, length: number): void {
  try {
    ftruncateSync(fd, length);
    fsyncSync(fd);
  } catch {
    throw new DurabilityLost("state file left in an unknown state");
  }
}

/** The file's lines, without the empty last one; none when the file does not exist yet (a state file's first boot). */
export function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/** Replaces the file with `lines`: written to a temporary file, fsynced, then renamed over it. */
export function replaceLines(file: string, lines: readonly string[]): void {
  const temporary = `${file}.tmp`;
  const fd = openSync(temporary, "w", 0o600);
  try {
    writeAll(fd, lines.map((line) => `${line}\n`).join(""));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
  syncDirectory(file);
}

/**
 * fsyncs the folder holding `file`, so a new or renamed entry survives a crash: fsync on a file persists its data, not
 * its directory entry (fsync(2), Linux man-pages 6.19, https://man7.org/linux/man-pages/man2/fsync.2.html). By then the
 * line or the rename is already in place, so a failure here leaves the file's durable state unknown: DurabilityLost.
 */
function syncDirectory(file: string): void {
  try {
    const fd = openSync(dirname(file), "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new DurabilityLost("state folder not synced");
  }
}
