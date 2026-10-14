// C9's path walk (P1.30, P1.34p), moved here unchanged from deployment/preflight/checks/secrets.ts (P1.33h; architecture
// record 2026-10-13-p129h-local-token-reader, Amendments 3 and 4) so the preflight and the token reader share one.
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

/** Why a walk failed, completing "<service> binds a path ..." or "<service> builds from a context ...". */
export const WALK_REASONS = {
  missing: "that does not exist",
  procfs: "under /proc",
  changeable: "that another user can change",
  loop: "through too many links",
  kind: "that is not a file or directory",
  fuse: "through a FUSE file system",
} as const;
export type WalkProblem = keyof typeof WALK_REASONS;

/** Linux follows at most 40 links while resolving one path (man7.org path_resolution(7)). */
const MAX_LINKS = 40;

/** What the walk reads: lstat, readlink and statfs, and the deploy user's uid. */
export type WalkInputs = {
  /** Like `stat`, but a symlink is reported as itself (C9 refuses a link anywhere on a mounted secret's path). */
  lstat: (path: string) => Stats | null;
  /** A link's target as written (`fs.readlinkSync`), throwing on any error (C9 fails closed). */
  readlink: (path: string) => string;
  /** The filesystem a path is on (`fs.statfsSync`), throwing on any error (C9 fails closed). */
  statfs: (path: string) => { type: number };
  uid: number;
};

/**
 * Resolves `path` from `/` one component at a time, as the kernel and Docker do again at every start, and judges every
 * entry met (architecture, Amendment 6 of 2026-10-12-p127u-bind-ancestors-and-build-context). Each directory entered
 * and the final entry are owned by root or the deploy user, with no group or other write and no sticky exception, and
 * are on neither `/proc` nor procfs. Each link is theirs too (its own mode means nothing on Linux); its target is
 * pushed back onto the path: absolute from `/`, relative from the link's folder, `..` popping. A user who could swap
 * any hop owns a directory or link on this walk. readlink and statfs errors throw, so C9 fails closed.
 */
export function resolveChecked(path: string, inputs: WalkInputs): WalkProblem | null {
  const pending = components(path);
  let at: string = sep;
  let links = 0;
  for (;;) {
    const info = inputs.lstat(at);
    const problem = info === null ? "missing" : entryProblem(at, info, pending.length > 0, inputs);
    if (problem !== null) return problem;
    if (info?.isSymbolicLink() === true) {
      if (++links > MAX_LINKS) return "loop";
      at = followLink(at, pending, inputs);
    }
    const next = pending.shift();
    if (next === undefined) return null;
    at = stepTo(at, next);
  }
}

/** The entry a component names from `at`: `.` stays, `..` pops ("/.." is "/"), any other name goes in. */
const stepTo = (at: string, next: string) => (next === "." ? at : next === ".." ? dirname(at) : join(at, next));

/** Puts a link's target back onto the pending components, and returns where the walk continues from. */
function followLink(link: string, pending: string[], inputs: WalkInputs): string {
  const target = inputs.readlink(link);
  pending.unshift(...components(target));
  return isAbsolute(target) ? sep : dirname(link);
}

/**
 * A path's components, without empty and `.` ones. A trailing `/` or `/.` asks for a folder (path_resolution(7), "if a
 * pathname ends in a '/', that forces resolution of the preceding component as in Step 2"), so it stays as one final
 * `.`, which keeps the walk where it is and so needs a directory to go on through.
 */
function components(path: string): string[] {
  const parts = path.split(sep).filter((part) => part !== "" && part !== ".");
  const folder = parts.length > 0 && (path.endsWith(sep) || path.endsWith(`${sep}.`));
  return folder ? [...parts, "."] : parts;
}

/** One entry on the walk; `more` when components remain, so the entry must be a directory to go on through. */
function entryProblem(at: string, info: Stats, more: boolean, inputs: WalkInputs): WalkProblem | null {
  if (within(at, "/proc")) return "procfs";
  if (info.uid !== 0 && info.uid !== inputs.uid) return "changeable";
  if (info.isSymbolicLink()) return null;
  if (more && !info.isDirectory()) return "missing";
  if (!info.isDirectory() && !info.isFile()) return "kind";
  if ((info.mode & 0o022) !== 0) return "changeable";
  return foreignFilesystem(at, inputs);
}

/**
 * The file systems C9 refuses, by statfs type (linux/magic.h): procfs (PROC_SUPER_MAGIC), so a bind-mounted alias of
 * /proc is known too, and FUSE (FUSE_SUPER_MAGIC), whose contents its user-space daemon decides on every read (P1.34p,
 * Amendment 2).
 */
const FOREIGN_FILESYSTEMS = new Map<number, "procfs" | "fuse">([
  [0x9fa0, "procfs"],
  [0x65735546, "fuse"],
]);
export const FILESYSTEM_NAMES = { procfs: "procfs", fuse: "FUSE" } as const;
export const foreignFilesystem = (path: string, { statfs }: WalkInputs) =>
  FOREIGN_FILESYSTEMS.get(statfs(path).type) ?? null;

/** Whether `path` is `folder` or lies under it, by path segments ("/" contains everything; "/a-b" is not in "/a"). */
export function within(path: string, folder: string): boolean {
  const rest = relative(folder, path);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}
