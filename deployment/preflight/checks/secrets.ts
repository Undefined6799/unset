// C9 (P1.30, P1.30o): every secret file the stack reads exists, holds something, and only its one reader can read it.
// Two kinds (architecture record 2026-10-12-c9-secret-file-owner):
// - Files Compose itself reads (env files and the `.env`): mode 0600, owned by the user running the deploy.
// - File secrets bind-mounted into containers keep the host file's owner and mode ("The `uid`, `gid`, and `mode`
//   attributes are not implemented in Docker Compose when the source of the secret is a `file`", compose-spec
//   05-services.md, secrets). So each is mode 0400 and owned by the numeric `user` uid of the services that mount it,
//   inside one directory that only the deploy user can reach: mode 0700, its own, reached through no link, under
//   parents no other user can change (P1.27a). A uid that collides with a host account then still cannot reach it.

import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { type Check, fail, type Inputs, type MountedSecret, missing, type Outcome, pass } from "./types.ts";

export const c9: Check = {
  id: "C9",
  run: (inputs) =>
    insideProjectProblem(inputs) ??
    mountedProblem(inputs) ??
    bindSourceProblem(inputs) ??
    composeReadProblem(inputs) ??
    pass(`${inputs.secretPaths.length} files, ${inputs.mountedSecrets.length} mounted secrets`),
};

/**
 * No env file or file secret lives in the Compose project directory, where the checkout's committed fixtures sit
 * (P1.34p, architecture Amendment 4 of 2026-10-12-p127u-bind-ancestors-and-build-context): judged by the same
 * lexical, realpath and (dev, ino) tests as a bind source. The project's `.env` always sits there; P1.34f refuses it.
 * The reason names no path.
 */
function insideProjectProblem(inputs: Inputs): Outcome | null {
  const dotEnv = join(inputs.projectDir, ".env");
  const files = [...inputs.secretPaths.filter((path) => path !== dotEnv), ...inputs.mountedSecrets.map((s) => s.path)];
  if (files.some((path) => reaches(path, inputs.projectDir, inputs)))
    return fail("an env or secret file is inside the Compose project directory");
  return null;
}

/** The files Compose itself reads values from: env files and the `.env`, each walked hop by hop (Amendment 6). */
function composeReadProblem(inputs: Inputs): Outcome | null {
  for (const path of inputs.secretPaths) {
    const problem = composeReadFileProblem(path, inputs);
    if (problem !== null) return problem;
  }
  return null;
}

function composeReadFileProblem(path: string, inputs: Inputs): Outcome | null {
  const walked = resolveChecked(path, inputs);
  if (walked === "missing") return missing(path);
  if (walked !== null && walked !== "kind") return fail(`${path} lies on a path ${WALK_REASONS[walked]}`);
  const info = inputs.stat(path);
  if (info === null) return missing(path);
  if (walked === "kind" || !info.isFile() || info.size === 0) return fail(`${path} is empty or not a file`);
  // A second name, inside the checkout for instance, would carry the values past C26's path test (Amendment 6).
  if (info.nlink !== 1) return fail(`${path} has more than one hard link`);
  // The values came from the file the reader opened; a swap since then means C9 would judge another file (P1.34p).
  if (inputs.envReads.get(path) !== `${info.dev}:${info.ino}`)
    return fail(`${path} changed after the preflight read it`);
  if ((info.mode & 0o777) !== 0o600) return fail(`${path} must have exactly owner read and write permissions`);
  if (info.uid !== inputs.uid) return fail(`${path} is not owned by the deploy user`);
  return null;
}

function mountedProblem(inputs: Inputs): Outcome | null {
  const { mountedSecrets } = inputs;
  const dirs = [...new Set(mountedSecrets.map((secret) => dirname(secret.path)))];
  if (dirs.length > 1) return fail("mounted secrets are not all in one directory");
  const [dir] = dirs;
  if (dir === undefined) return null;
  const locked = lockedDirectoryProblem(dir, inputs);
  if (locked !== null) return locked;
  for (const secret of mountedSecrets) {
    const problem = secretFileProblem(secret, inputs.lstat(secret.path));
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * The secrets folder is the deploy user's, mode 0700, and is judged where it really is: no component of its path is a
 * link (Docker resolves a bind source again at every start), and no user but root and the deploy user can change any
 * directory above it, sticky or not (OpenSSH safe_path, misc.c; CERT FIO15-C). Ancestors are named by position.
 */
function lockedDirectoryProblem(dir: string, inputs: Inputs): Outcome | null {
  const info = inputs.lstat(dir);
  if (info === null) return missing(dir);
  if (!info.isDirectory() || (info.mode & 0o7777) !== 0o700 || info.uid !== inputs.uid) {
    return fail(`${dir} must be a directory with mode 0700 owned by the deploy user`);
  }
  const foreign = foreignFilesystem(dir, inputs);
  if (foreign !== null) return fail(`the secrets folder is on ${FILESYSTEM_NAMES[foreign]}`);
  return ancestorProblem(dir, inputs);
}

/** The secrets folder's parents, nearest first, each named by its position. */
function ancestorProblem(dir: string, inputs: Inputs): Outcome | null {
  let level = 1;
  for (let parent = dirname(dir); ; parent = dirname(parent), level++) {
    const above = inputs.lstat(parent);
    const foreign = above?.isDirectory() === true ? foreignFilesystem(parent, inputs) : null;
    if (foreign !== null) return fail(`the secrets folder is on ${FILESYSTEM_NAMES[foreign]}`);
    if (above === null || !above.isDirectory())
      return fail(`parent ${level} of the secrets folder is a link or not a directory`);
    const othersOwn = above.uid !== 0 && above.uid !== inputs.uid;
    if (othersOwn || (above.mode & 0o022) !== 0) {
      return fail(`parent ${level} of the secrets folder can be changed by another user`);
    }
    if (dirname(parent) === parent) return null;
  }
}

/**
 * Whether `path` is a mounted secret's folder, lies inside one or contains one: by path segments, as written and
 * resolved, and by (dev, ino) for a second name no link explains (Amendment 3). C26 asks it of build contexts too.
 */
export function reachesSecretsFolder(path: string, inputs: Inputs): boolean {
  const dirs = new Set(inputs.mountedSecrets.map((secret) => dirname(secret.path)));
  return [...dirs].some((dir) => reaches(path, dir, inputs));
}

/** Whether `path` is or contains a file Compose reads values from (an env file or the `.env`), by the same tests. */
export function holdsEnvFile(path: string, inputs: Inputs): boolean {
  return inputs.secretPaths.some((file) => reaches(path, file, inputs));
}

/**
 * Whether `path` reaches an env file, or the folder of one other than the project's own `.env` (P1.34p, Amendment 2):
 * is it, lies inside it or contains it, by the same tests. insideProjectProblem has already refused env files inside
 * the project directory, so these folders lie outside it.
 */
function reachesEnvInput(path: string, inputs: Inputs): boolean {
  const dotEnv = join(inputs.projectDir, ".env");
  const folders = new Set(inputs.secretPaths.filter((file) => file !== dotEnv).map((file) => dirname(file)));
  return holdsEnvFile(path, inputs) || [...folders].some((folder) => reaches(path, folder, inputs));
}

function reaches(path: string, dir: string, inputs: Inputs): boolean {
  const folders = [dir, inputs.realpath(dir) ?? dir];
  const paths = [path, inputs.realpath(path) ?? path];
  const related = (a: string, b: string) => within(a, b) || within(b, a);
  if (paths.some((at) => folders.some((folder) => related(at, folder)))) return true;
  return sharesIdentity(identities(paths[1] as string, inputs), identities(folders[1] as string, inputs));
}

/**
 * Every bind source, `:ro` included, is walked hop by hop (architecture record
 * 2026-10-12-p127u-bind-ancestors-and-build-context, (a) and Amendment 6): a user who can change an entry on its path
 * can swap the source after the preflight, onto the secrets folder or onto content of their own. It must exist, since
 * Compose creates a missing one (a dangling link's target too) as root, and never lie under /proc, which resolves in
 * the preflight's context, not the container's.
 */
function bindSourceProblem(inputs: Inputs): Outcome | null {
  for (const service of inputs.compose.services) {
    for (const mount of service.mounts) {
      if (mount.type !== "bind" || mount.source === null) continue;
      const reason = bindReason(mount.source, inputs);
      if (reason !== null) return fail(`${service.name} binds a path ${reason}`);
    }
  }
  return null;
}

/** Why one bind source fails, completing "<service> binds a path ...", or null. */
function bindReason(source: string, inputs: Inputs): string | null {
  // Secrets reach containers only through `secrets:` (architecture, Amendment 2 of
  // 2026-10-12-c9-secret-file-owner): a source that is the secrets folder, lies inside it or contains it fails.
  if (reachesSecretsFolder(source, inputs)) return "that reaches the secrets folder";
  if (reachesEnvInput(source, inputs)) return "that reaches an env file or the env folder";
  const walked = resolveChecked(source, inputs);
  return walked === null ? null : WALK_REASONS[walked];
}

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
export type WalkInputs = Pick<Inputs, "lstat" | "readlink" | "statfs" | "uid">;

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
const FILESYSTEM_NAMES = { procfs: "procfs", fuse: "FUSE" } as const;
const foreignFilesystem = (path: string, { statfs }: WalkInputs) => FOREIGN_FILESYSTEMS.get(statfs(path).type) ?? null;

/**
 * The (dev, ino) of a path and of each directory above it, nearest first; null where nothing exists. A second name
 * for the secrets folder that no link explains (a host bind mount) has other path segments but the same identity
 * (architecture, Amendment 3).
 */
function identities(path: string, { stat }: Inputs): (string | null)[] {
  const line: (string | null)[] = [];
  for (let at = path; ; at = dirname(at)) {
    const info = stat(at);
    line.push(info === null ? null : `${info.dev}:${info.ino}`);
    if (dirname(at) === at) return line;
  }
}

/** The bind source is the folder or above it (its own identity is on the folder's line), or lies inside it. */
function sharesIdentity(sourceLine: (string | null)[], folderLine: (string | null)[]): boolean {
  const [source = null] = sourceLine;
  const [folder = null] = folderLine;
  return (source !== null && folderLine.includes(source)) || (folder !== null && sourceLine.includes(folder));
}

/** Whether `path` is `folder` or lies under it, by path segments ("/" contains everything; "/a-b" is not in "/a"). */
function within(path: string, folder: string): boolean {
  const rest = relative(folder, path);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}

function secretFileProblem({ path, mountedBy }: MountedSecret, info: Stats | null): Outcome | null {
  if (info === null) return missing(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size === 0) return fail(`${path} is empty, a link or not a file`);
  if ((info.mode & 0o7777) !== 0o400) return fail(`${path} must have mode 0400`);
  // A second name outside the locked folder would reach the same file (Postfix safe_open.c refuses st_nlink != 1).
  if (info.nlink !== 1) return fail(`${path} has more than one hard link`);
  if (mountedBy.length === 0) return fail(`${path} is declared but no service mounts it`);
  const unset = mountedBy.find((reader) => reader.user === null);
  if (unset !== undefined) return fail(`${unset.service} mounts ${path} but sets no user`);
  // P1.30x keeps `user` a non-zero numeric UID[:GID].
  const uids = new Set(mountedBy.map((reader) => Number(reader.user?.split(":")[0])));
  const [owner] = uids;
  if (uids.size > 1 || owner === undefined) return fail(`${path} is mounted by more than one uid`);
  if (info.uid !== owner) {
    const names = mountedBy.map((reader) => reader.service).join(", ");
    return fail(`${path} is not owned by uid ${owner}, the user of ${names}`);
  }
  return null;
}
