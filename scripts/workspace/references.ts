// The workspace convention (P1.01, scripts/workspace/new-workspace.md), checked on a repository tree.
// Which workspace may reference which is read from the dependency-cruiser MATRIX, so the import
// boundaries and the tsconfig/package.json references are one list (rule AB-1).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { sourceFiles } from "../guards/files.ts";

type PathRule = { path?: string; pathNot?: string | string[] };
type Row = { name: string; from: PathRule; to: (PathRule & { dependencyTypes?: string[] })[] };
type BoundaryConfig = { MATRIX: Row[]; ZERO_DEP_ALLOWLIST: string[]; RENDER_ENTRIES: Record<string, string> };

const ROOT = join(import.meta.dirname, "..", "..");
const boundaries: BoundaryConfig = createRequire(import.meta.url)(join(ROOT, ".dependency-cruiser.cjs"));

/** Top-level folders that may hold workspaces (decision 34); root package.json `workspaces` lists the same. */
export const WORKSPACE_TOPS = ["apps", "interfaces", "domains", "infrastructure", "shared"] as const;
/** Folders decision 34 and decision 25 rule out. */
const FORBIDDEN_TOPS = ["packages", "modules", "plugins"];
const ADMIN_SERVICES = ["interfaces/pds-admin", "interfaces/chat-admin"];
const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts)$/;
const UNSET_IMPORT = /(?:from\s+|import\s*\(\s*)["'](@unset\/[^"'/]+)/g;

/** A workspace as found on disk: its repo-relative folder (`domains/identity`) and parsed manifests. */
export type Workspace = { dir: string; pkg: Record<string, unknown>; tsconfig: Record<string, unknown> };

function readJson(root: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;
}

const subdirs = (root: string, dir: string): string[] =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir), { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "node_modules")
        .map((e) => e.name)
    : [];

/** Every `<top>/<name>/package.json` under the repository root, whatever `<top>` is. */
export function findWorkspaces(root: string): Workspace[] {
  return subdirs(root, ".")
    .filter((top) => !top.startsWith("."))
    .flatMap((top) => subdirs(root, top).map((name) => `${top}/${name}`))
    .filter((dir) => existsSync(join(root, dir, "package.json")))
    .sort()
    .map((dir) => ({
      dir,
      pkg: readJson(root, `${dir}/package.json`),
      tsconfig: existsSync(join(root, dir, "tsconfig.json")) ? readJson(root, `${dir}/tsconfig.json`) : {},
    }));
}

const matches = (rule: PathRule, file: string): RegExpMatchArray | null => {
  const not = rule.pathNot === undefined ? [] : [rule.pathNot].flat();
  if (not.some((p) => new RegExp(p).test(file))) return null;
  return file.match(new RegExp(rule.path ?? ""));
};

/** True when some MATRIX row lets a file of `fromDir` import `toFile` (depcruise's $n substitution included). */
function matrixAllows(fromDir: string, toFile: string): boolean {
  const fromFile = `${fromDir}/x.ts`;
  return boundaries.MATRIX.some((row) => {
    const groups = matches(row.from, fromFile);
    if (!groups) return false;
    return row.to.some((to) => {
      if (to.path === undefined) return false; // npm or core-module entries reach no workspace
      const path = to.path.replace(/\$(\d)/g, (_, i: string) => groups[Number(i)] ?? "");
      return new RegExp(path).test(toFile);
    });
  });
}

/** A workspace may reference another when the MATRIX lets it import that workspace's index or render entry. */
export function mayReference(fromDir: string, toDir: string): boolean {
  const entries = [
    `${toDir}/index.ts`,
    ...Object.values(boundaries.RENDER_ENTRIES).filter((f) => f.startsWith(`${toDir}/`)),
  ];
  return entries.some((file) => matrixAllows(fromDir, file));
}

const unsetDependencies = (pkg: Record<string, unknown>): string[] =>
  Object.keys((pkg.dependencies ?? {}) as Record<string, string>).filter((d) => d.startsWith("@unset/"));

const referencePaths = (tsconfig: Record<string, unknown>): string[] =>
  ((tsconfig.references ?? []) as { path: string }[]).map((r) => r.path);

/** `../../shared/config` written in domains/identity/tsconfig.json → `shared/config`. */
const fromWorkspace = (ref: string): string => ref.replace(/^\.\.\/\.\.\//, "").replace(/\/$/, "");

function manifestProblems({ dir, pkg, tsconfig }: Workspace): string[] {
  const [top, name] = dir.split("/");
  const license = top === "shared" ? "MIT" : "AGPL-3.0-only";
  const options = (tsconfig.compilerOptions ?? {}) as Record<string, unknown>;
  const expected: [string, unknown, unknown][] = [
    ["package.json name", pkg.name, `@unset/${top}-${name}`],
    ["package.json private", pkg.private, true],
    ["package.json type", pkg.type, "module"],
    ["package.json version", pkg.version, "0.0.0"],
    ["package.json license", pkg.license, license],
    ["tsconfig.json extends", tsconfig.extends, "../../tsconfig.base.json"],
    ["tsconfig.json composite", options.composite, true],
    ["tsconfig.json rootDir", options.rootDir, "."],
    ["tsconfig.json outDir", options.outDir, "dist"],
  ];
  return expected
    .filter(([, actual, want]) => actual !== want)
    .map(([field, actual, want]) => `${dir}: ${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(want)}`);
}

function referenceProblems(ws: Workspace, byName: Map<string, string>): string[] {
  const problems: string[] = [];
  const refs = referencePaths(ws.tsconfig).map(fromWorkspace);
  const deps = unsetDependencies(ws.pkg).map((d) => byName.get(d) ?? d);
  for (const target of new Set([...refs, ...deps])) {
    if (!mayReference(ws.dir, target)) problems.push(`${ws.dir}: may not reference ${target} (MATRIX)`);
  }
  const hasDeps = Object.keys((ws.pkg.dependencies ?? {}) as object).length > 0;
  const zeroDep = ADMIN_SERVICES.includes(ws.dir) || boundaries.ZERO_DEP_ALLOWLIST.includes(`${ws.dir}/`);
  if (zeroDep && hasDeps) problems.push(`${ws.dir}: zero-dependency workspace has dependencies (plan §5.2)`);
  if (zeroDep && boundaries.ZERO_DEP_ALLOWLIST.includes(`${ws.dir}/`) && refs.length > 0) {
    problems.push(`${ws.dir}: zero-dependency allowlist workspace has references`);
  }
  if (ws.dir.startsWith("domains/") && hasDeps) problems.push(`${ws.dir}: a domain has no npm dependencies (AB-1)`);
  return problems;
}

/** Each `@unset/*` package imported by a workspace's code must be in its dependencies and references. */
function importProblems(root: string, ws: Workspace, byName: Map<string, string>): string[] {
  const refs = new Set(referencePaths(ws.tsconfig).map(fromWorkspace));
  const deps = new Set(unsetDependencies(ws.pkg));
  const imported = new Set(
    sourceFiles(root, [ws.dir]).flatMap((f) =>
      [...readFileSync(join(root, f), "utf8").matchAll(UNSET_IMPORT)].map((m) => m[1] ?? ""),
    ),
  );
  return [...imported].flatMap((name) => {
    const target = byName.get(name);
    if (target === undefined) return [`${ws.dir}: imports ${name}, which is no workspace`];
    if (target === ws.dir) return [];
    // A zero-dependency service lists no dependencies at all (plan §5.2); its tsconfig reference is the record.
    const needsDep = !ADMIN_SERVICES.includes(ws.dir) && !deps.has(name);
    const missing = [needsDep ? "package.json dependencies" : "", refs.has(target) ? "" : "tsconfig references"];
    return missing.filter(Boolean).map((where) => `${ws.dir}: imports ${name} without it in ${where}`);
  });
}

/** Every rule of the workspace convention, as a sorted list of problems; empty means the tree conforms. */
export function workspaceProblems(root: string): string[] {
  const workspaces = findWorkspaces(root);
  const byName = new Map(workspaces.map((ws) => [String(ws.pkg.name), ws.dir]));
  const rootRefs = new Set(referencePaths(readJson(root, "tsconfig.json")));
  const problems = FORBIDDEN_TOPS.filter((top) => existsSync(join(root, top))).map(
    (top) => `${top}/: folder not allowed (decisions 25 and 34)`,
  );
  if (!rootRefs.has("scripts")) problems.push("tsconfig.json: references no scripts project");
  for (const ws of workspaces) {
    const top = ws.dir.split("/")[0] ?? "";
    if (!(WORKSPACE_TOPS as readonly string[]).includes(top)) {
      problems.push(`${ws.dir}: workspace outside the decision-34 folders`);
      continue;
    }
    if (!rootRefs.has(ws.dir)) problems.push(`tsconfig.json: references no ${ws.dir}`);
    if (!sourceFiles(root, [ws.dir]).some((f) => TEST_FILE.test(f))) problems.push(`${ws.dir}: has no *.test.ts`);
    problems.push(...manifestProblems(ws), ...referenceProblems(ws, byName), ...importProblems(root, ws, byName));
  }
  return problems.sort();
}
