// The root lockfile's scope in a trusted-base PR (rule SE-6, ruling 2026-10-05 02:50Z): every entry the PR adds,
// changes or moves is a changed trusted package's own workspace entry or in its dependency closure, so that npm
// re-hoisting an existing package passes. A trusted package the PR creates also explains its own link entry (ruling
// 2026-10-06 19:50Z). Pure; `change-shape.ts` reads both lockfiles.
// Format: npm lockfile v2/v3 `packages`, keyed by install path ("" is the root, "node_modules/a", "shared/http").
//
// The closure is a set of install paths, not of names: an entry elsewhere that merely shares a name and version is
// outside it (adversarial review of P0.09f). A version the base already has keeps its tarball and dependency lists at
// every path, so a PR cannot swap a known package or widen the closure through an existing entry. A version new to
// the lockfile is taken as npm wrote it; the dependencies guard, audit, the 7-day rule and the SBOM judge it.

import { isDeepStrictEqual } from "node:util";

/** A trusted workspace the PR creates (ruling 2026-10-06 19:50Z, P1.14q): its folder and the name its manifest declares. */
export type NewWorkspace = { readonly dir: string; readonly name: string };

type Entry = { name?: unknown; version?: unknown; link?: unknown; resolved?: unknown; [field: string]: unknown };
type Packages = Record<string, Entry>;

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
/** What npm fetches and runs for a name@version: the same in every copy, whatever its path or flags. */
const CONTENT_FIELDS = ["resolved", "integrity", "hasInstallScript", "bin", ...DEPENDENCY_FIELDS];
/** Where npm's tree puts the copy (dev-only, optional), which changes when a dependency moves between them. */
const FLAG_FIELDS = new Set(["dev", "optional", "devOptional", "peer"]);

function packagesOf(lockfile: unknown): Packages | null {
  const packages = (lockfile as { packages?: unknown } | null)?.packages;
  if (typeof packages !== "object" || packages === null || Array.isArray(packages)) return null;
  const entries = Object.values(packages);
  return entries.every((e) => typeof e === "object" && e !== null && !Array.isArray(e)) ? (packages as Packages) : null;
}

/** The name Node loads at `key`: the path after the last `node_modules/` (a workspace entry: its `name`). */
function nameOf(key: string, entry: Entry): string {
  const at = key.lastIndexOf("node_modules/");
  if (at >= 0) return key.slice(at + "node_modules/".length);
  return typeof entry.name === "string" ? entry.name : key;
}

const identity = (key: string, entry: Entry): string =>
  `${nameOf(key, entry)}@${typeof entry.version === "string" ? entry.version : "?"}`;

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

/** Every install path reachable from the workspaces, links followed to the workspace they point at. */
function closure(packages: Packages, workspaces: readonly string[]): Set<string> {
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
    for (const name of dependencyNames(entry)) {
      const target = resolve(packages, key, name);
      if (target !== null) queue.push(target); // an optional or peer dependency may be absent
    }
  }
  return seen;
}

const content = (entry: Entry) => CONTENT_FIELDS.map((field) => entry[field]);
const withoutFlags = (entry: Entry) => Object.entries(entry).filter(([field]) => !FLAG_FIELDS.has(field));

/** The base's content for each name@version; two differing base copies keep the first (any other then differs). */
function baseContents(packages: Packages): Map<string, unknown[]> {
  const contents = new Map<string, unknown[]>();
  for (const [key, entry] of Object.entries(packages)) {
    if (key.includes("node_modules/") && !contents.has(identity(key, entry)))
      contents.set(identity(key, entry), content(entry));
  }
  return contents;
}

/** Each key whose entry differs, split into its base side and its head side, with pure moves paired off. */
function changedSides(before: Packages, after: Packages): { removed: [string, Entry][]; added: [string, Entry][] } {
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
      ([to, other]) => nameOf(to, other) === nameOf(key, entry) && isDeepStrictEqual(other, entry),
    );
    if (move >= 0) {
      removed.splice(i, 1);
      added.splice(move, 1);
    }
  }
  return { removed, added };
}

/**
 * The lockfile entries this PR changes that the trusted workspaces do not explain, as "key (name@version)". A side
 * removed or changed must sit in the base closure (an upgrade drops the old copy), a side added or changed in the
 * head closure; a removal and an addition of the same name and content are one move. An entry whose `name` is not
 * the name its path loads, or a known version with a new tarball or dependency list, is outside wherever it sits.
 */
export function lockfileStrays(
  base: unknown,
  head: unknown,
  workspaces: readonly string[],
  born: readonly NewWorkspace[] = [],
): string[] {
  const [before, after] = [packagesOf(base), packagesOf(head)];
  if (before === null || after === null) return ["package-lock.json has no packages map"];
  const [baseClosure, headClosure] = [closure(before, workspaces), closure(after, workspaces)];
  const known = baseContents(before);
  const { removed, added } = changedSides(before, after);
  const flagsOnly = (key: string): boolean =>
    before[key] !== undefined &&
    after[key] !== undefined &&
    isDeepStrictEqual(withoutFlags(before[key]), withoutFlags(after[key])) &&
    (baseClosure.has(key) || headClosure.has(key));
  // A new workspace's own link, `node_modules/<its name>` resolving to its folder, is the one entry outside the closure
  // it explains; the same name linked anywhere else is a stray.
  const ownLink = (key: string, entry: Entry): boolean =>
    before[key] === undefined &&
    born.some(
      (w) => w.name !== "" && key === `node_modules/${w.name}` && entry.link === true && entry.resolved === w.dir,
    );
  const strays = new Set<string>();
  for (const [key, entry] of removed) {
    if (!baseClosure.has(key) && !flagsOnly(key)) strays.add(`${key || "(root)"} (${identity(key, entry)})`);
  }
  for (const [key, entry] of added) {
    const alias = key.includes("node_modules/") && typeof entry.name === "string" && entry.name !== nameOf(key, entry);
    const baseContent = known.get(identity(key, entry));
    const swapped = baseContent !== undefined && !isDeepStrictEqual(baseContent, content(entry));
    if (ownLink(key, entry)) continue;
    if ((!headClosure.has(key) && !flagsOnly(key)) || alias || swapped)
      strays.add(`${key || "(root)"} (${identity(key, entry)})`);
  }
  return [...strays].sort();
}
