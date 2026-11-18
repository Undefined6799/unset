// Durable appends for pds-admin's state files: each line is written and fsynced before the call returns, so a crash
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
 * Appends one line and fsyncs it. A write that fails part-way is cut back to the file's old length, so the next line
 * never joins a torn one (a jti merged into a torn line would be lost on reopen). If even the cut fails, the error
 * still propagates and the caller refuses the request.
 */
export function appendLine(file: string, line: string): void {
  const fd = openSync(file, "a", 0o600);
  try {
    const before = fstatSync(fd).size;
    try {
      writeAll(fd, `${line}\n`);
    } catch (error) {
      ftruncateSync(fd, before);
      fsyncSync(fd);
      throw error;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
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
}
