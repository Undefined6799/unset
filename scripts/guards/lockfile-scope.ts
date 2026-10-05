// The root lockfile's scope in a trusted-base PR (rule SE-6, ruling 2026-10-05 02:50Z): every entry the PR adds,
// changes or moves is a changed trusted package's own workspace entry or in its dependency closure, matched by name
// and version so that npm re-hoisting an existing package passes. Pure; `change-shape.ts` reads both lockfiles.
// Format: npm lockfile v2/v3 `packages`, keyed by install path ("" is the root, "node_modules/a", "shared/http").

import { isDeepStrictEqual } from "node:util";

type Entry = { name?: unknown; version?: unknown; link?: unknown; resolved?: unknown; [field: string]: unknown };
type Packages = Record<string, Entry>;

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function packagesOf(lockfile: unknown): Packages | null {
  const packages = (lockfile as { packages?: unknown } | null)?.packages;
  return typeof packages === "object" && packages !== null && !Array.isArray(packages) ? (packages as Packages) : null;
}

/** name@version of the entry at `key`; the name comes from the path after the last `node_modules/`. */
function identity(key: string, entry: Entry): string {
  const at = key.lastIndexOf("node_modules/");
  const name = typeof entry.name === "string" ? entry.name : at < 0 ? key : key.slice(at + "node_modules/".length);
  return `${name}@${typeof entry.version === "string" ? entry.version : "?"}`;
}

/** The install path whose `node_modules` Node searches next: "node_modules/a/node_modules/b" → "node_modules/a". */
function parentOf(key: string): string {
  const at = key.lastIndexOf("/node_modules/");
  return at < 0 ? "" : key.slice(0, at);
}

/** Node's lookup from `from` up to the root, as npm lays the tree out. */
function resolve(packages: Packages, from: string, name: string): string | null {
  for (let dir = from; ; dir = parentOf(dir)) {
    const key = `${dir === "" ? "" : `${dir}/`}node_modules/${name}`;
    if (key in packages) return key;
    if (dir === "") return null;
  }
}

const dependencyNames = (entry: Entry): string[] =>
  DEPENDENCY_FIELDS.flatMap((field) => Object.keys((entry[field] as Record<string, unknown> | undefined) ?? {}));

/** Every name@version reachable from the workspaces, links followed to the workspace they point at. */
function closure(packages: Packages, workspaces: readonly string[]): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const queue = [...workspaces];
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    const entry = packages[key];
    if (entry === undefined || seen.has(key)) continue;
    seen.add(key);
    if (entry.link === true && typeof entry.resolved === "string") {
      queue.push(entry.resolved);
      continue;
    }
    found.add(identity(key, entry));
    for (const name of dependencyNames(entry)) {
      const target = resolve(packages, key, name);
      if (target !== null) queue.push(target); // an optional or peer dependency may be absent
    }
  }
  return found;
}

/**
 * The lockfile entries this PR changes that the trusted workspaces do not explain, as "key (name@version)". An
 * entry removed or changed counts its base side against the base closure (an upgrade drops the old copy); an entry
 * added or changed counts its head side against the head closure. A removal and an addition with the same identity
 * and content are one move, which is not a change.
 */
export function lockfileStrays(base: unknown, head: unknown, workspaces: readonly string[]): string[] {
  const [before, after] = [packagesOf(base), packagesOf(head)];
  if (before === null || after === null) return ["package-lock.json has no packages map"];
  const removed: [string, Entry][] = [];
  const added: [string, Entry][] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isDeepStrictEqual(before[key], after[key])) continue;
    if (before[key] !== undefined) removed.push([key, before[key]]);
    if (after[key] !== undefined) added.push([key, after[key]]);
  }
  for (let i = removed.length - 1; i >= 0; i--) {
    const [key, entry] = removed[i] as [string, Entry];
    const move = added.findIndex(
      ([to, other]) => isDeepStrictEqual(other, entry) && identity(to, other) === identity(key, entry),
    );
    if (move >= 0) {
      removed.splice(i, 1);
      added.splice(move, 1);
    }
  }
  const strays = new Set<string>();
  const judge = (entries: [string, Entry][], packages: Packages) => {
    const allowed = closure(packages, workspaces);
    for (const [key, entry] of entries) {
      const ownLink = entry.link === true && workspaces.includes(entry.resolved as string);
      if (workspaces.includes(key) || ownLink || allowed.has(identity(key, entry))) continue;
      strays.add(`${key === "" ? "(root)" : key} (${identity(key, entry)})`);
    }
  };
  judge(removed, before);
  judge(added, after);
  return [...strays].sort();
}
