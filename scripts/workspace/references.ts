// The workspace convention (P1.01, scripts/workspace/new-workspace.md), checked on a repository tree.
// Which workspace may reference which is read from the dependency-cruiser MATRIX, so the import
// boundaries and the tsconfig/package.json references are one list (rule AB-1).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, sep } from "node:path";
import { sourceFiles } from "../guards/files.ts";

type PathRule = { path?: string; pathNot?: string | string[] };
type Row = { name: string; from: PathRule; to: (PathRule & { dependencyTypes?: string[] })[] };
type BoundaryConfig = { MATRIX: Row[]; ZERO_DEP_ALLOWLIST: string[]; RENDER_ENTRIES: Record<string, string> };

const ROOT = join(import.meta.dirname, "..", "..");
const boundaries: BoundaryConfig = createRequire(import.meta.url)(join(ROOT, "scripts/lint/.dependency-cruiser.cjs"));

/** Top-level folders that may hold workspaces (decision 34); root package.json `workspaces` lists the same. */
export const WORKSPACE_TOPS = ["apps", "interfaces", "domains", "infrastructure", "shared"] as const;
/** Folders decision 34 and decision 25 rule out. */
const FORBIDDEN_TOPS = ["packages", "modules", "plugins"];
const ADMIN_SERVICES = ["interfaces/pds-admin", "interfaces/chat-admin"];
/** devDependencies a zero-dependency workspace may still list: test tooling, never shipped. */
const TEST_TOOLING = new Set(["vitest"]);
const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts)$/;
// `from "…"`, `import("…")`, a side-effect `import "…"` and `require("…")`.
const UNSET_IMPORT = /(?:from\s+|import\s*\(?\s*|require\s*\(\s*)["'](@unset\/[^"'/]+)/g;
/** Every manifest field that installs a package. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

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

/** Every package a manifest names, in any dependency field. */
const allDependencies = (pkg: Record<string, unknown>): string[] =>
  DEPENDENCY_FIELDS.flatMap((field) => Object.keys((pkg[field] ?? {}) as Record<string, string>));

const unsetDependencies = (pkg: Record<string, unknown>): string[] =>
  allDependencies(pkg).filter((d) => d.startsWith("@unset/"));

const referencePaths = (tsconfig: Record<string, unknown>): string[] =>
  ((tsconfig.references ?? []) as { path: string }[]).map((r) => r.path);

/** A tsconfig reference resolved from the folder that holds it: `../../shared/config` in `domains/identity` →
 * `shared/config`. A path that leaves the repository stays visibly wrong (`../x`) and fails the MATRIX check. */
const resolveReference = (fromDir: string, ref: string): string =>
  posix.normalize(posix.join(fromDir, ref)).replace(/\/$/, "");

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
  const refs = referencePaths(ws.tsconfig).map((ref) => resolveReference(ws.dir, ref));
  const deps = unsetDependencies(ws.pkg).map((d) => byName.get(d) ?? d);
  for (const target of new Set([...refs, ...deps])) {
    if (!mayReference(ws.dir, target)) problems.push(`${ws.dir}: may not reference ${target} (MATRIX)`);
  }
  const hasDeps = allDependencies(ws.pkg).some((d) => !d.startsWith("@unset/"));
  if (ws.dir.startsWith("domains/") && hasDeps) problems.push(`${ws.dir}: a domain has no npm dependencies (AB-1)`);
  return problems;
}

/**
 * "Zero dependencies" means no third-party package (plan §5.2; architecture ruling 2026-10-04): an admin service
 * depends only on allowlisted `@unset/*` workspaces, and an allowlisted workspace depends on and references nothing.
 */
function zeroDependencyProblems(ws: Workspace, byName: Map<string, string>): string[] {
  const allowlisted = boundaries.ZERO_DEP_ALLOWLIST.includes(`${ws.dir}/`);
  if (!allowlisted && !ADMIN_SERVICES.includes(ws.dir)) return [];
  const named = (field: string): string[] => Object.keys((ws.pkg[field] ?? {}) as object);
  const declared = DEPENDENCY_FIELDS.flatMap((field) =>
    named(field).filter((d) => field !== "devDependencies" || !TEST_TOOLING.has(d)),
  );
  const allowed = (dep: string): boolean =>
    !allowlisted && boundaries.ZERO_DEP_ALLOWLIST.includes(`${byName.get(dep) ?? ""}/`);
  const problems = declared
    .filter((dep) => !allowed(dep))
    .map((dep) => `${ws.dir}: zero-dependency workspace depends on ${dep} (plan §5.2)`);
  if (allowlisted && referencePaths(ws.tsconfig).length > 0) {
    problems.push(`${ws.dir}: zero-dependency allowlist workspace has references`);
  }
  return problems;
}

/** Every package `npm ls` finds in a workspace's installed production closure, the workspace itself excluded. */
function installedClosure(root: string, ws: Workspace): string[] | null {
  const run = spawnSync("npm", ["ls", "--workspace", ws.dir, "--all", "--json", "--omit=dev"], {
    cwd: root,
    encoding: "utf8",
  });
  type Node = { dependencies?: Record<string, Node> };
  let tree: Node;
  try {
    tree = JSON.parse(run.stdout ?? "") as Node;
  } catch {
    return null;
  }
  const names = (node: Node): string[] =>
    Object.entries(node.dependencies ?? {}).flatMap(([name, child]) => [name, ...names(child)]);
  return names(tree.dependencies?.[String(ws.pkg.name)] ?? {});
}

/** The installed closure of each admin service holds no third-party package (defence in depth over the manifests). */
export function closureProblems(root: string): string[] {
  return findWorkspaces(root)
    .filter((ws) => ADMIN_SERVICES.includes(ws.dir))
    .flatMap((ws) => {
      const closure = installedClosure(root, ws);
      if (closure === null) return [`${ws.dir}: npm ls gave no readable tree`];
      return [...new Set(closure)]
        .filter((name) => !name.startsWith("@unset/"))
        .map((name) => `${ws.dir}: third-party package ${name} in the installed closure (plan §5.2)`);
    });
}

/** Each `@unset/*` package imported by a workspace's code must be in its dependencies and references. */
function importProblems(root: string, ws: Workspace, byName: Map<string, string>): string[] {
  const refs = new Set(referencePaths(ws.tsconfig).map((ref) => resolveReference(ws.dir, ref)));
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
    const missing = [deps.has(name) ? "" : "package.json dependencies", refs.has(target) ? "" : "tsconfig references"];
    return missing.filter(Boolean).map((where) => `${ws.dir}: imports ${name} without it in ${where}`);
  });
}

/** Every rule of the workspace convention, as a sorted list of problems; empty means the tree conforms. */
export function workspaceProblems(root: string): string[] {
  const workspaces = findWorkspaces(root);
  const byName = new Map(workspaces.map((ws) => [String(ws.pkg.name), ws.dir]));
  const rootRefs = new Set(referencePaths(readJson(root, "tsconfig.json")).map((ref) => resolveReference(".", ref)));
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
    problems.push(
      ...manifestProblems(ws),
      ...referenceProblems(ws, byName),
      ...zeroDependencyProblems(ws, byName),
      ...importProblems(root, ws, byName),
    );
  }
  return problems.sort();
}

const TS_SOURCE = /\.(?:ts|tsx|mts|cts)$/;
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

/**
 * TypeScript files no project in the root `tsconfig.json` compiles. `tsc -b` checks only the projects it is given,
 * so a file outside every project (a new `tests/` or `deployment/` folder, a code folder with no `package.json`)
 * would otherwise go unchecked while Vitest still runs it.
 */
export function untypecheckedFiles(root: string): string[] {
  const projects = referencePaths(readJson(root, "tsconfig.json")).map((ref) => resolveReference(".", ref));
  const covered = new Set(
    projects.flatMap((project) => {
      const run = spawnSync(TSC, ["-p", join(project, "tsconfig.json"), "--listFilesOnly"], {
        cwd: root,
        encoding: "utf8",
      });
      return (run.stdout ?? "").split("\n").map((file) => relative(root, file.trim()).split(sep).join("/"));
    }),
  );
  return sourceFiles(root, ["."]).filter((f) => TS_SOURCE.test(f) && !f.endsWith(".d.ts") && !covered.has(f));
}
