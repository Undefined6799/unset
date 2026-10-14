// The pin on the Docker daemon (P1.34s), moved here unchanged from deployment/preflight/stack.ts (P1.33h; architecture
// record 2026-10-13-p129h-local-token-reader, Amendments 3 and 4) so the stack wrapper and the token reader share one.
import { lstatSync, readlinkSync, statfsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { resolveChecked, WALK_REASONS, type WalkInputs } from "./walk.ts";

/** The daemon both children use when the caller sets no DOCKER_HOST: the local root daemon. */
export const DEFAULT_DOCKER_HOST = "unix:///var/run/docker.sock";

export class UsageError extends Error {}

const NOT_LOCAL = "DOCKER_HOST must be a Docker socket on this machine";

/**
 * The caller's DOCKER_HOST, or the local default, if it names a socket on this machine that only root or the deploy
 * user controls (P1.34s; architecture record 2026-10-12-workspace-imports-and-remote-daemon, Amendment 3): `unix://`
 * and an absolute path. Its folder passes C9's own walk, resolveChecked, unchanged, so no hop through a link, a
 * folder another user can write (a sticky /tmp too) or /proc reaches it; `/var/run -> /run` and a rootless
 * /run/user/<uid>/docker.sock pass. The socket itself is a socket, not a link, owned by root or the deploy user, with
 * one name (nlink 1). tcp://, ssh://, npipe:// and anything else are refused. Every reason is fixed text, never the
 * value.
 */
export function localDockerHost(from: Readonly<Record<string, string | undefined>>, inputs: WalkInputs): string {
  const host = from.DOCKER_HOST ?? DEFAULT_DOCKER_HOST;
  const path = host.startsWith("unix://") ? host.slice("unix://".length) : "";
  if (!isAbsolute(path)) throw new UsageError(NOT_LOCAL);
  const walked = resolveChecked(dirname(path), inputs);
  if (walked !== null) throw new UsageError(`${NOT_LOCAL}: its folder is a path ${WALK_REASONS[walked]}`);
  const socket = inputs.lstat(path);
  if (socket?.isSymbolicLink() === true) throw new UsageError(`${NOT_LOCAL}: it is a link, not the socket`);
  if (socket === null || !socket.isSocket()) throw new UsageError(NOT_LOCAL);
  if (socket.uid !== 0 && socket.uid !== inputs.uid) throw new UsageError(`${NOT_LOCAL}: another user owns it`);
  if (socket.nlink !== 1) throw new UsageError(`${NOT_LOCAL}: it has another name (a hard link)`);
  return host;
}

/** This machine's file system and the deploy user, as the preflight reads them (index.ts). */
export const hostWalk: WalkInputs = {
  lstat: (path) => lstatSync(path, { throwIfNoEntry: false }) ?? null,
  readlink: (path) => readlinkSync(path),
  statfs: (path) => statfsSync(path),
  uid: process.getuid?.() ?? -1,
};
