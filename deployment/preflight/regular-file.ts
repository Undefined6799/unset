// Reading a file only as a regular file (P1.34p, Amendment 2): the certificates C18 judges (P1.35p S2), so a FIFO, a
// folder or a device at one of those paths never blocks or misleads the preflight. The env files Compose reads have
// their own reader in inputs.ts, which walks the path before it opens it (P1.34r).
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";

/** What readRegular answers for a path that holds something other than a regular file. */
export const NOT_REGULAR = "not a regular file";

/** The file could not be opened for a reason other than its absence (EACCES, ELOOP); the caller names the path. */
export class UnreadableFile extends Error {}

/**
 * A file's text and the `dev:ino` of the file it came from. Its real path is opened with O_NOFOLLOW, so a link swapped
 * in after realpath(3) fails, and O_NONBLOCK, so a FIFO opens without a writer instead of blocking ("open the file in
 * nonblocking mode", Node v26.10.0 doc/api/fs.md, File open constants). The descriptor is fstat'ed and read only if it
 * is a regular file (readFileSync takes a descriptor, the same page). Null only when nothing exists.
 */
export function readRegular(path: string): { text: string; id: string } | null | typeof NOT_REGULAR {
  let fd: number;
  try {
    fd = openSync(realpathSync.native(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw new UnreadableFile(`cannot read ${path}`);
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return NOT_REGULAR;
    return { text: readFileSync(fd, "utf8"), id: `${info.dev}:${info.ino}` };
  } finally {
    closeSync(fd);
  }
}
