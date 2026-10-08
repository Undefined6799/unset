// What may reroute an import past the raw-specifier allowlist (P1.28k; architecture amendment 10 item 2 in
// 2026-10-07-p130s-networks-and-caddyfile-reader.md; step book 2026-10-08-p128k-root-absolute-and-unresolved-imports.md,
// amendments 1 and 2). An allowed specifier is only as safe as where package.json and tsconfig send it:
// - Node resolves a package's own name, and a `#` import, through its package.json `exports` and `imports` (Node
//   v26.10.0 doc/api/packages.md: "Self-referencing a package using its name" :862, "Subpath imports" :524). An exports
//   target must start with `./` (:452); an imports target may name an external package (:1345), refused here.
//   `main`, `module` and `browser` are the older entry points bundlers still read.
// - TypeScript's `paths` and `baseUrl` (typescriptlang.org/tsconfig#paths) let a bare name mean any file.
// - dependency-cruiser's `exclude` drops a dependency that resolves into a skipped folder, so a tracked file there
//   is invisible to every rule (shown on a fixture, 2026-10-08).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const ROUTE_FIELDS = ["exports", "imports", "main", "module", "browser"] as const;
/** Folders the cruise and the guards skip that must hold no tracked file (the two fixture folders are the exception). */
const SKIPPED = /(^|\/)(dist|coverage|graphify-out|\.worktrees)\//;

type Manifest = Record<string, unknown>;

/** Every string target under a package.json route field, walking condition objects and arrays. */
function targets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (value && typeof value === "object") return Object.values(value).flatMap(targets);
  return []; // null and false block a path; they route nowhere
}

/** The real path of `path`, or of its nearest existing ancestor joined with the rest. */
function realish(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realish(parent), relative(parent, path));
}

const inside = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Targets of a workspace's route fields that leave its directory, by spelling or through a symlink. */
export function escapingTargets(root: string, dir: string, manifest: Manifest): string[] {
  const home = resolve(root, dir);
  const out: string[] = [];
  for (const field of ROUTE_FIELDS) {
    for (const target of targets(manifest[field])) {
      const path = resolve(home, target.split("*")[0] ?? "");
      // Node requires `./` on an exports or imports target; `main` and friends are plain relative paths.
      const spelled = field === "exports" || field === "imports" ? target.startsWith("./") : !isAbsolute(target);
      if (!spelled || !inside(home, path) || !inside(realish(home), realish(path))) {
        out.push(`${dir}/package.json ${field} → ${target}`);
      }
    }
  }
  return out;
}

/** What in one tracked file (other than the root package.json) could reroute an import. */
function fileProblems(root: string, file: string, read: (file: string) => Manifest): string[] {
  if (SKIPPED.test(file)) return [`${file} is tracked in a folder the cruise skips`];
  if (/(^|\/)package\.json$/.test(file)) return escapingTargets(root, dirname(file), read(file));
  if (!/(^|\/)tsconfig[^/]*\.json$/.test(file)) return [];
  const options = (read(file).compilerOptions ?? {}) as Manifest;
  return ["paths", "baseUrl"].filter((key) => key in options).map((key) => `${file} declares ${key}`);
}

/** Everything that could reroute an import in a repository whose tracked files are `files`. */
export function reroutingProblems(root: string, files: string[]): string[] {
  const read = (file: string): Manifest => JSON.parse(readFileSync(join(root, file), "utf8"));
  const top = read("package.json");
  return [
    ...ROUTE_FIELDS.filter((field) => field in top).map((field) => `package.json has ${field}`),
    ...files.filter((file) => file !== "package.json").flatMap((file) => fileProblems(root, file, read)),
  ];
}
