// C9 (P1.30, P1.30o): every secret file the stack reads exists, holds something, and only its one reader can read it.
// Two kinds (architecture record 2026-10-12-c9-secret-file-owner):
// - Files Compose itself reads (env files and the `.env`): mode 0600, owned by the user running the deploy.
// - File secrets bind-mounted into containers keep the host file's owner and mode ("The `uid`, `gid`, and `mode`
//   attributes are not implemented in Docker Compose when the source of the secret is a `file`", compose-spec
//   05-services.md, secrets). So each is mode 0400 and owned by the numeric `user` uid of the services that mount it,
//   inside one directory that only the deploy user can reach: mode 0700, its own, reached through no link, under
//   parents no other user can change (P1.27a). A uid that collides with a host account then still cannot reach it.

import type { Stats } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { type Check, fail, type Inputs, type MountedSecret, missing, type Outcome, pass } from "./types.ts";

export const c9: Check = {
  id: "C9",
  run: (inputs) => {
    for (const path of inputs.secretPaths) {
      const info = inputs.stat(path);
      if (info === null) return missing(path);
      if (!info.isFile() || info.size === 0) return fail(`${path} is empty or not a file`);
      if ((info.mode & 0o777) !== 0o600) return fail(`${path} must have exactly owner read and write permissions`);
      if (info.uid !== inputs.uid) return fail(`${path} is not owned by the deploy user`);
    }
    const mounted = mountedProblem(inputs);
    if (mounted !== null) return mounted;
    return pass(`${inputs.secretPaths.length} files, ${inputs.mountedSecrets.length} mounted secrets`);
  },
};

function mountedProblem(inputs: Inputs): Outcome | null {
  const { mountedSecrets } = inputs;
  const dirs = [...new Set(mountedSecrets.map((secret) => dirname(secret.path)))];
  if (dirs.length > 1) return fail("mounted secrets are not all in one directory");
  const [dir] = dirs;
  if (dir === undefined) return null;
  const locked = lockedDirectoryProblem(dir, inputs);
  if (locked !== null) return locked;
  const bound = bindReachingProblem(dir, inputs);
  if (bound !== null) return bound;
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
function lockedDirectoryProblem(dir: string, { lstat, uid }: Inputs): Outcome | null {
  const info = lstat(dir);
  if (info === null) return missing(dir);
  if (!info.isDirectory() || (info.mode & 0o7777) !== 0o700 || info.uid !== uid) {
    return fail(`${dir} must be a directory with mode 0700 owned by the deploy user`);
  }
  let level = 1;
  for (let parent = dirname(dir); ; parent = dirname(parent), level++) {
    const above = lstat(parent);
    if (above === null || !above.isDirectory())
      return fail(`parent ${level} of the secrets folder is a link or not a directory`);
    const othersOwn = above.uid !== 0 && above.uid !== uid;
    if (othersOwn || (above.mode & 0o022) !== 0) {
      return fail(`parent ${level} of the secrets folder can be changed by another user`);
    }
    if (dirname(parent) === parent) return null;
  }
}

/**
 * Secrets reach containers only through `secrets:` (architecture, Amendment 2 of 2026-10-12-c9-secret-file-owner): a
 * bind mount whose source, as written or resolved, is the secrets folder, lies inside it or contains it is refused.
 */
function bindReachingProblem(dir: string, inputs: Inputs): Outcome | null {
  const { compose, realpath } = inputs;
  const folders = [dir, realpath(dir) ?? dir];
  const folderLine = identities(folders[1] as string, inputs);
  const related = (a: string, b: string) => within(a, b) || within(b, a);
  for (const service of compose.services) {
    for (const mount of service.mounts) {
      if (mount.type !== "bind" || mount.source === null) continue;
      const sources = [mount.source, realpath(mount.source) ?? mount.source];
      const byPath = sources.some((source) => folders.some((folder) => related(source, folder)));
      if (byPath || sharesIdentity(identities(sources[1] as string, inputs), folderLine)) {
        return fail(`${service.name} binds a path that reaches the secrets folder`);
      }
    }
  }
  return null;
}

/**
 * The (dev, ino) of a path and of each directory above it, nearest first; null where nothing exists. A second name for the secrets folder that no
 * link explains (a host bind mount) has other path segments but the same identity (architecture, Amendment 3).
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
