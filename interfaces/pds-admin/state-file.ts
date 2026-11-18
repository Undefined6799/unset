// Durable appends for pds-admin's state files: each line is written and fsynced before the call returns, so a crash
// cannot lose a line the service has acted on. Synchronous on purpose: the service is tiny, and a line on disk before
// the next await is what makes the replay check race-free (P2.09 step 7).
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";

/** Appends one line and fsyncs it. */
export function appendLine(file: string, line: string): void {
  const fd = openSync(file, "a", 0o600);
  try {
    writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The file's lines, without the empty last one; none when the file does not exist yet. */
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
    writeSync(fd, lines.map((line) => `${line}\n`).join(""));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}
