// Licence compatibility over production dependencies (P0.13; ADR 0012, decision 27). An MIT package (every package
// under shared/) may depend only on permissive licences, never on an AGPL workspace package; an AGPL-3.0-only package
// may also depend on AGPL-3.0 code. Anything else, an unknown package licence or a missing licence field is a conflict:
// the agent stops and asks Alex with the dependency named (P0.13 step 5). No `npx` tool: `npm ls` reads the installed
// tree and runs nothing.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaces } from "../workspace/references.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const NPM_TIMEOUT_MS = 60_000;

/** Permissive SPDX ids an MIT package may depend on (ADR 0012). */
export const PERMISSIVE = [
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Zlib",
];
/** What a package under each of our two licences may depend on. A licence not listed here is itself a conflict. */
export const ALLOWED: Record<string, readonly string[]> = {
  MIT: PERMISSIVE,
  "AGPL-3.0-only": [...PERMISSIVE, "AGPL-3.0-only", "AGPL-3.0-or-later"],
};

/** SPDX exceptions that only widen a licence; any other `WITH` (Commons-Clause restricts it) fails. */
export const EXCEPTIONS = ["LLVM-exception"];

/**
 * A node of `npm ls --json --long`: the package's manifest fields, where it is installed, and its resolved
 * dependencies. `_dependencies` and `peerDependencies` are what the manifest declares (npm 11.19.1 output).
 */
export type LsNode = {
  version?: string;
  license?: unknown;
  missing?: boolean;
  path?: string;
  _dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, LsNode>;
};
/** One installed copy. `unlisted`: npm printed it without children although it declares some (fail closed). */
export type Dependency = { name: string; version: string; license: unknown; missing: boolean; unlisted: boolean };

/**
 * True when the SPDX expression can be satisfied from `allowed`: `A OR B` needs one side, `A AND B` both, parentheses
 * group, `WITH <exception>` keeps the base licence when the exception is on EXCEPTIONS. Anything unparseable is
 * false (fail closed).
 */
export function satisfies(expression: string, allowed: readonly string[]): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const factor = (): boolean | null => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = or();
      return tokens[at++] === ")" ? inner : null;
    }
    if (token === undefined || token === ")" || /^(AND|OR|WITH)$/.test(token)) return null;
    if (peek() !== "WITH") return allowed.includes(token);
    const exception = tokens[at + 1];
    at += 2;
    return exception !== undefined && EXCEPTIONS.includes(exception) ? allowed.includes(token) : null;
  };
  const and = (): boolean | null => {
    let value = factor();
    while (value !== null && peek() === "AND") {
      at++;
      const next = factor();
      value = next === null ? null : value && next;
    }
    return value;
  };
  const or = (): boolean | null => {
    let value = and();
    while (value !== null && peek() === "OR") {
      at++;
      const next = and();
      value = next === null ? null : value || next;
    }
    return value;
  };
  const result = or();
  return result === true && at === tokens.length;
}

const hasChildren = (node: LsNode): boolean => Object.keys(node.dependencies ?? {}).length > 0;

/** Whether the manifest declares a dependency npm must install: any regular one, or a peer not marked optional. */
const declaresDependencies = (node: LsNode): boolean =>
  Object.keys(node._dependencies ?? {}).length > 0 ||
  Object.keys(node.peerDependencies ?? {}).some((peer) => node.peerDependenciesMeta?.[peer]?.optional !== true);

const installedCopy = (name: string, node: LsNode, unlisted: boolean): Dependency => ({
  name,
  version: node.version ?? "?",
  license: node.license,
  missing: node.missing === true,
  unlisted,
});

/**
 * Every copy in `tree` that npm printed with its children, by install path. npm prints a package once in full and
 * every other copy at the same path (deduped) with its manifest only (npm 11.19.1 `lib/commands/ls.js`: `seenNodes`
 * is keyed by `node.path`, and `--long` sets `item.path`); the copy for one workspace may be the stub while the full one
 * sits under another workspace or the root.
 */
export function indexByPath(tree: LsNode): Map<string, LsNode> {
  const index = new Map<string, LsNode>();
  const visit = (node: LsNode): void => {
    for (const child of Object.values(node.dependencies ?? {})) {
      if (child.path === undefined || !hasChildren(child) || index.has(child.path)) continue;
      index.set(child.path, child);
      visit(child);
    }
  };
  visit(tree);
  return index;
}

/**
 * Every installed copy below `node`. A copy printed without children is expanded through `index` by its install
 * path; one that declares dependencies but has no full copy anywhere is `unlisted` (fail closed). Every copy is
 * recorded unless an identical record exists, so two copies of one name@version that disagree on licence are both
 * checked. Each
 * install path is walked once (the tree under it is the same wherever it is listed), and a node already on the current
 * walk ends it (no cycle). An optional dependency that is not installed shows as `{}` and is
 * skipped: nothing ships.
 */
export function flatten(node: LsNode, index: Map<string, LsNode> = indexByPath(node)): Dependency[] {
  const found = new Map<string, Dependency>();
  const onWalk = new Set<string | LsNode>();
  const done = new Set<string | LsNode>();
  const expand = (listed: LsNode): LsNode =>
    hasChildren(listed) || listed.path === undefined ? listed : (index.get(listed.path) ?? listed);
  const walk = (listed: LsNode): void => {
    const self = listed.path ?? listed;
    if (onWalk.has(self) || done.has(self)) return;
    onWalk.add(self);
    for (const [name, child] of Object.entries(expand(listed).dependencies ?? {})) {
      // An optional dependency that is not installed prints as `{}`, with no path (npm 11.19.1 ls.js skips the --long
      // fields for missing nodes); an installed package always has a path, even without a `version` field.
      if (child.version === undefined && child.path === undefined && child.missing !== true) continue;
      const copy = installedCopy(name, child, !hasChildren(expand(child)) && declaresDependencies(child));
      const key = JSON.stringify(copy);
      if (!found.has(key)) found.set(key, copy);
      walk(child);
    }
    onWalk.delete(self);
    done.add(self);
  };
  walk(node);
  return [...found.values()];
}

/** The conflicts of one package: its own licence unknown, or a dependency missing, unlicensed or not allowed. */
export function checkPackage(name: string, licence: unknown, dependencies: readonly Dependency[]): string[] {
  const allowed = typeof licence === "string" ? ALLOWED[licence] : undefined;
  if (allowed === undefined)
    return [`${name}: package licence ${JSON.stringify(licence)} is neither MIT nor AGPL-3.0-only`];
  const conflicts: string[] = [];
  for (const dep of dependencies) {
    const id = `${dep.name}@${dep.version}`;
    if (dep.missing) conflicts.push(`${name}: ${id} is not installed, so its licence is unknown`);
    else if (dep.unlisted) conflicts.push(`${name}: ${id} has children not listed by npm ls`);
    else if (typeof dep.license !== "string") conflicts.push(`${name}: ${id} has no licence field`);
    else if (!satisfies(dep.license, allowed)) conflicts.push(`${name} (${licence}): ${id} is ${dep.license}`);
  }
  return conflicts;
}

/**
 * The production tree of the root and every workspace from one `npm ls` run: each spawn costs about 0.3 s, and one
 * per workspace pushed the test past its timeout (P0.13a, measured on npm 11.19.1). Workspaces are the root's
 * top-level entries, whose dependencies may be stubs of copies listed under another workspace (see indexByPath).
 */
export function productionTree(): LsNode & { name?: string } {
  const run = spawnSync(
    "npm",
    ["ls", "--all", "--json", "--long", "--omit=dev", "--workspaces", "--include-workspace-root"],
    { cwd: ROOT, encoding: "utf8", timeout: NPM_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error) throw run.error;
  // npm ls exits 1 when the tree has problems; a missing package still shows in the JSON, so read it either way.
  return JSON.parse(run.stdout) as LsNode & { name?: string };
}

/**
 * The root's declared dependencies that the tree does not list. With `--workspaces`, npm 11.19.1 leaves a root
 * dependency that is not installed out of the JSON entirely (`lib/commands/ls.js` `filterBySelectedWorkspaces` keeps
 * only edges with a target), so the manifest is compared with the tree. An optional one that is missing ships nothing.
 */
export function rootDependenciesNotListed(manifest: Record<string, unknown>, tree: LsNode): string[] {
  const declared = Object.keys((manifest.dependencies ?? {}) as Record<string, string>);
  return declared
    .filter((name) => tree.dependencies?.[name] === undefined)
    .map((name) => `${String(manifest.name)}: ${name} is not installed, so its licence is unknown`);
}

/** Conflicts across the root package and every workspace package in the repository, from one listed tree. */
export function checkRepository(list: () => LsNode & { name?: string } = productionTree): string[] {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
  const workspaces = findWorkspaces(ROOT);
  const tree = list();
  if (tree.name !== root.name) throw new Error(`npm ls did not list the root package ${String(root.name)}`);
  const index = indexByPath(tree);
  const names = new Set(workspaces.map(({ pkg }) => String(pkg.name)));
  // The root's own dependencies: its entries that are not workspaces.
  const own = Object.entries(tree.dependencies ?? {}).filter(([name]) => !names.has(name));
  const conflicts = rootDependenciesNotListed(root, tree);
  conflicts.push(
    ...checkPackage(String(root.name), root.license, flatten({ dependencies: Object.fromEntries(own) }, index)),
  );
  for (const { dir, pkg } of workspaces) {
    const name = String(pkg.name);
    const node = tree.dependencies?.[name];
    if (node === undefined) throw new Error(`npm ls did not list ${name} (${dir}); run npm ci first`);
    conflicts.push(...checkPackage(name, pkg.license, flatten(node, index)));
  }
  return conflicts;
}

function main(): number {
  const conflicts = checkRepository();
  for (const line of conflicts) console.log(`::error::[licence] ${line}`);
  if (conflicts.length === 0) console.log("licence: every workspace's production dependencies are compatible");
  return conflicts.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
