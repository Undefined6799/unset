// The workspace convention (P1.01, scripts/workspace/new-workspace.md), checked on a repository tree.
// Which workspace may reference which is read from the dependency-cruiser MATRIX, so the import
// boundaries and the tsconfig/package.json references are one list (rule AB-1).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
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

/** Repo-relative files `tsc --listFilesOnly` reports for one project. */
function listedFiles(root: string, project: string): string[] {
  const run = spawnSync(TSC, ["-p", join(project, "tsconfig.json"), "--listFilesOnly"], {
    cwd: root,
    encoding: "utf8",
  });
  return (run.stdout ?? "").split("\n").map((file) => relative(root, file.trim()).split(sep).join("/"));
}

/** Why a nested project's effective options (extends resolved, by `tsc --showConfig`) keep it from checking its
 * files, or null: it must be composite and must not set noCheck (architecture Amendment 1 condition 3). */
function nestedOptionProblem(root: string, project: string): string | null {
  const run = spawnSync(TSC, ["-p", join(project, "tsconfig.json"), "--showConfig"], { cwd: root, encoding: "utf8" });
  let options: Record<string, unknown>;
  try {
    options = (JSON.parse(run.stdout ?? "") as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
  } catch {
    return `${project}: tsc --showConfig gave no readable config`;
  }
  if (options.composite !== true) return `${project}: a nested project must set composite`;
  if (options.noCheck === true) return `${project}: a nested project may not set noCheck`;
  return null;
}

const realpath = (path: string): string | null => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

/** Why `ref`, written in `parent`'s tsconfig, may not add a nested project, or null: it must name a folder with a
 * tsconfig.json strictly inside `parent`, with no `..`, no node_modules and no link out (condition 2). */
function containmentProblem(root: string, parent: string, ref: string): string | null {
  const refused = `${parent}: reference ${ref} is not a project inside ${parent}`;
  if (ref.split(/[\\/]/).includes("..")) return refused;
  const home = realpath(join(root, parent));
  const child = realpath(join(root, parent, ref));
  const config = realpath(join(root, parent, ref, "tsconfig.json"));
  if (home === null || child === null || config === null) return refused;
  const inside = (path: string) =>
    path.startsWith(`${home}${sep}`) && !path.slice(home.length).split(sep).includes("node_modules");
  return inside(child) && inside(config) ? null : refused;
}

type Step = { dir: string; real: string | null };
type Walk = { root: string; tops: Set<string | null>; walked: Set<string>; covered: Set<string>; problems: string[] };

/**
 * Every file some project in the walk lists, and why any project in it fails. The walk starts at the root
 * `tsconfig.json`'s references and follows each project's own references, as `tsc -b` does (architecture record
 * 2026-10-12-p131-depcruise-and-lexicon-choices, Amendment 1). A root-referenced project's reference to another is
 * left to the root walk. Any other reference names a nested project, which must sit inside its parent and pass the
 * option rules, or its files do not count. A reference back to a project on the current path is a cycle and a
 * finding; a project reached twice by different paths is walked once.
 */
function typecheckWalk(root: string): Walk {
  const tops = referencePaths(readJson(root, "tsconfig.json")).map((ref) => resolveReference(".", ref));
  const walk: Walk = {
    root,
    tops: new Set(tops.map((project) => realpath(join(root, project)))),
    walked: new Set(),
    covered: new Set(),
    problems: [],
  };
  for (const project of tops) visitProject(walk, project, []);
  return walk;
}

/** Counts `project`'s files once it passes, then follows its references; `path` is the chain that reached it. */
function visitProject(walk: Walk, project: string, path: Step[]): void {
  const real = realpath(join(walk.root, project));
  if (walk.walked.has(real ?? project)) return;
  walk.walked.add(real ?? project);
  if (path.length > 0) {
    const problem = nestedOptionProblem(walk.root, project);
    if (problem !== null) return void walk.problems.push(problem);
  }
  for (const file of listedFiles(walk.root, project)) walk.covered.add(file);
  const config = `${project}/tsconfig.json`;
  const refs = existsSync(join(walk.root, config)) ? referencePaths(readJson(walk.root, config)) : [];
  for (const ref of refs) followReference(walk, [...path, { dir: project, real }], ref);
}

/** Checks one reference from the last project on `path`, in order: a cycle, a root-to-root reference, containment. */
function followReference(walk: Walk, path: Step[], ref: string): void {
  const parent = path.at(-1)?.dir ?? ".";
  const child = resolveReference(parent, ref);
  const real = realpath(join(walk.root, child));
  if (real !== null && path.some((step) => step.real === real)) {
    const chain = [...path.map((step) => step.dir), child].join(" -> ");
    return void walk.problems.push(`${child}: tsconfig references form a cycle (${chain})`);
  }
  // Only a root-referenced project's references may reach another root-referenced project (MATRIX governs those).
  if (path.length === 1 && real !== null && walk.tops.has(real)) return;
  const contained = containmentProblem(walk.root, parent, ref);
  if (contained !== null) return void walk.problems.push(contained);
  visitProject(walk, child, path);
}

/**
 * TypeScript files no passing project in the walk compiles, after a finding for each project the walk refuses.
 * `tsc -b` checks only the projects it is given, so a file outside every project (a new `tests/` or `deployment/`
 * folder, a code folder with no `package.json`) would otherwise go unchecked while Vitest still runs it.
 */
export function untypecheckedFiles(root: string): string[] {
  const { covered, problems } = typecheckWalk(root);
  const files = sourceFiles(root, ["."]).filter((f) => TS_SOURCE.test(f) && !f.endsWith(".d.ts") && !covered.has(f));
  return [...problems.sort(), ...files];
}
