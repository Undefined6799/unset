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

/** A node of `npm ls --json --long`: the package's manifest fields plus its resolved dependencies. */
export type LsNode = { version?: string; license?: unknown; missing?: boolean; dependencies?: Record<string, LsNode> };
export type Dependency = { name: string; version: string; license: unknown; missing: boolean };

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

/**
 * Every package below `node`, listed once per name@version. npm prints a deduped copy with its manifest but without
 * its children, so every copy is walked; a node already on the current path ends the walk (no cycle). An optional
 * dependency that is not installed shows as `{}` and is skipped: nothing ships.
 */
export function flatten(node: LsNode): Dependency[] {
  const seen = new Map<string, Dependency>();
  const path = new Set<LsNode>();
  const walk = (current: LsNode): void => {
    if (path.has(current)) return;
    path.add(current);
    for (const [name, child] of Object.entries(current.dependencies ?? {})) {
      if (child.version === undefined && child.missing !== true) continue;
      const id = `${name}@${child.version ?? "?"}`;
      if (!seen.has(id)) {
        seen.set(id, { name, version: child.version ?? "?", license: child.license, missing: child.missing === true });
      }
      walk(child);
    }
    path.delete(current);
  };
  walk(node);
  return [...seen.values()];
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
    else if (typeof dep.license !== "string") conflicts.push(`${name}: ${id} has no licence field`);
    else if (!satisfies(dep.license, allowed)) conflicts.push(`${name} (${licence}): ${id} is ${dep.license}`);
  }
  return conflicts;
}

/** The production tree of one workspace (or of the root alone, `dir` null), from `npm ls` run in the repository. */
function productionTree(dir: string | null, name: string): LsNode {
  const scope = dir === null ? ["--workspaces=false"] : ["-w", dir];
  const run = spawnSync("npm", ["ls", "--all", "--json", "--long", "--omit=dev", ...scope], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: NPM_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  // npm ls exits 1 when the tree has problems; a missing package still shows in the JSON, so read it either way.
  const root = JSON.parse(run.stdout) as LsNode & { name?: string };
  if (dir === null) {
    if (root.name !== name) throw new Error(`npm ls did not list the root package ${name}`);
    return root;
  }
  const node = root.dependencies?.[name];
  if (node === undefined) throw new Error(`npm ls did not list ${name} (${dir}); run npm ci first`);
  return node;
}

/** Conflicts across the root package and every workspace package in the repository. */
export function checkRepository(): string[] {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
  const packages: { dir: string | null; pkg: Record<string, unknown> }[] = [{ dir: null, pkg: root }];
  return [...packages, ...findWorkspaces(ROOT)].flatMap(({ dir, pkg }) => {
    const name = String(pkg.name);
    return checkPackage(name, pkg.license, flatten(productionTree(dir, name)));
  });
}

function main(): number {
  const conflicts = checkRepository();
  for (const line of conflicts) console.log(`::error::[licence] ${line}`);
  if (conflicts.length === 0) console.log("licence: every workspace's production dependencies are compatible");
  return conflicts.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
