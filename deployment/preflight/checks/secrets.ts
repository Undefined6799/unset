// C9 (P1.30, P1.30o): every secret file the stack reads exists, holds something, and only its one reader can read it.
// Two kinds (architecture record 2026-10-12-c9-secret-file-owner):
// - Files Compose itself reads (env files and the `.env`): mode 0600, owned by the user running the deploy.
// - File secrets bind-mounted into containers keep the host file's owner and mode ("The `uid`, `gid`, and `mode`
//   attributes are not implemented in Docker Compose when the source of the secret is a `file`", compose-spec
//   05-services.md, secrets). So each is mode 0400 and owned by the numeric `user` uid of the services that mount it,
//   inside one directory that only the deploy user can reach: mode 0700, its own, under parents no other user can
//   change. A uid that collides with a host account then still cannot reach the file.

import type { Stats } from "node:fs";
import { dirname } from "node:path";
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
  for (const secret of mountedSecrets) {
    const problem = secretFileProblem(secret, inputs.lstat(secret.path));
    if (problem !== null) return problem;
  }
  return null;
}

/** The secrets directory is the deploy user's, mode 0700, and no other user can change any directory above it. */
function lockedDirectoryProblem(dir: string, { lstat, stat, uid }: Inputs): Outcome | null {
  const info = lstat(dir);
  if (info === null) return missing(dir);
  if (!info.isDirectory() || (info.mode & 0o7777) !== 0o700 || info.uid !== uid) {
    return fail(`${dir} must be a directory with mode 0700 owned by the deploy user`);
  }
  for (let parent = dirname(dir); ; parent = dirname(parent)) {
    const above = stat(parent);
    if (above === null) return missing(parent);
    if (changeableByOthers(above, uid)) return fail(`${parent} can be changed by another user`);
    if (dirname(parent) === parent) return null;
  }
}

/**
 * Whether a user other than root and the deploy user could rename or replace an entry in this directory: they own it,
 * or it is group or world writable without the sticky bit, which keeps others from renaming what they do not own.
 */
function changeableByOthers(info: Stats, deployUid: number): boolean {
  if (info.uid !== 0 && info.uid !== deployUid) return true;
  return (info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0;
}

function secretFileProblem({ path, mountedBy }: MountedSecret, info: Stats | null): Outcome | null {
  if (info === null) return missing(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size === 0) return fail(`${path} is empty, a link or not a file`);
  if ((info.mode & 0o7777) !== 0o400) return fail(`${path} must have mode 0400`);
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
