// The raw-specifier allowlist (P1.28k; architecture amendment 10 in 2026-10-07-p130s-networks-and-caddyfile-reader.md;
// step book 2026-10-08-p128k-root-absolute-and-unresolved-imports.md, amendments 1 and 2). dependency-cruiser's path
// rules judge where an import resolved to, never how it was spelled, so a spelling the resolver rewrites or cannot
// follow escapes them. This check reads each dependency's specifier from the cruise result and allows only our forms.
//
// dependency-cruiser 18.5.0 (node_modules/dependency-cruiser/src/extract/helpers.mjs:76-100, extractModuleAttributes)
// keeps the specifier in `module`, except that it moves a `node:` prefix to `protocol` for built-ins that do not need
// it; `file:`, `data:` and `bun:` stay in `module`, and its prefix match is case-sensitive. So a built-in is allowed by
// `protocol` plus `coreModule`, and every other scheme is still visible in `module`.
import { existsSync, readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import type { ICruiseResult } from "dependency-cruiser";

type Manifest = {
  name?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
/** What the check needs from the package.json files: names, and what each one declares. */
export type Packages = {
  rootName: string;
  root: ReadonlySet<string>;
  /** Workspace directory (repo-relative, no trailing slash) to its name and declared packages. */
  workspaces: ReadonlyMap<string, { name: string; declared: ReadonlySet<string> }>;
  /** Whether a repo-relative file is a test file, the only kind the root package.json covers inside a workspace. */
  testFile: (file: string) => boolean;
};

const declared = (manifest: Manifest): Set<string> =>
  new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);

/**
 * Test files by the Vitest `include` globs (P1.28m). node:path matchesGlob is stable since Node v24.8.0 (Node v26.10.0
 * doc/api/path.md, "path.matchesGlob"); the docs do not name brace expansion, so the tests show `{ts,tsx}` matching.
 */
export const testFileByGlobs =
  (globs: string[]) =>
  (file: string): boolean =>
    globs.some((glob) => matchesGlob(file, glob));

/** Reads the root package.json and every workspace it lists (`dir/*` patterns, as this repo writes them). */
export function readPackages(root: string, list: (dir: string) => string[], testGlobs: string[]): Packages {
  const read = (dir: string): Manifest => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const top = read(".");
  const workspaces = new Map<string, { name: string; declared: ReadonlySet<string> }>();
  for (const pattern of top.workspaces ?? []) {
    if (!pattern.endsWith("/*")) throw new Error(`workspace pattern ${pattern}: only dir/* is read`);
    for (const dir of list(pattern.slice(0, -2))) {
      if (!existsSync(join(root, dir, "package.json"))) continue; // npm skips a folder with no manifest too
      const manifest = read(dir);
      workspaces.set(dir, { name: manifest.name ?? "", declared: declared(manifest) });
    }
  }
  return { rootName: top.name ?? "", root: declared(top), workspaces, testFile: testFileByGlobs(testGlobs) };
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const RELATIVE = /^\.{1,2}(\/|$)/;

// A package name as npm accepts new ones (docs.npmjs.com/cli/v11/configuring-npm/package-json, "name"): an optional
// scope, lower case, URL-safe, and no leading dot or underscore (held for scopes too, which npm would allow).
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** The package name a bare specifier names, and the rest of it; undefined when the name is malformed. */
function splitBare(spec: string): { name: string; rest: string[] } | undefined {
  const parts = spec.split("/");
  const name = parts.slice(0, spec.startsWith("@") ? 2 : 1).join("/");
  return PACKAGE_NAME.test(name) ? { name, rest: parts.slice(name.split("/").length) } : undefined;
}

function owner(packages: Packages, file: string): ReadonlySet<string> | undefined {
  for (const [dir, workspace] of packages.workspaces) if (file.startsWith(`${dir}/`)) return workspace.declared;
  return undefined;
}

/** Why `spec`, imported by `file`, is refused; undefined when it is one of our allowed forms. */
export function refusal(packages: Packages, file: string, spec: string): string | undefined {
  if (spec.includes("\\")) return "a backslash";
  if (spec.startsWith("/")) return "a root-absolute path";
  if (SCHEME.test(spec)) return "a URL scheme";
  if (spec.startsWith("#")) return "a # subpath import";
  if (RELATIVE.test(spec)) return undefined;
  const bare = splitBare(spec);
  if (!bare) return "a malformed package name";
  if (bare.rest.some((part) => part === "." || part === ".." || part === "")) return "a dot or empty segment";
  if (bare.name === packages.rootName) return "the root package's own name";
  return declaredRefusal(packages, file, bare.name);
}

/** Why the package `name`, imported by `file`, is not one this repository declares for that file. */
function declaredRefusal(packages: Packages, file: string, name: string): string | undefined {
  if (name.startsWith("@unset/")) {
    const known = [...packages.workspaces.values()].some((w) => w.name === name);
    return known ? undefined : "an @unset name that is no workspace";
  }
  // P1.28k amendment 2 and P1.28m: a root-level file uses the root package.json; a workspace file uses its own, and
  // falls back to the root one only when it is a test file (shared test tooling is hoisted to the root).
  const own = owner(packages, file);
  if (!own) return packages.root.has(name) ? undefined : "a package the root package.json does not declare";
  if (own.has(name)) return undefined;
  if (!packages.root.has(name)) return "a package neither its workspace nor the root package.json declares";
  return packages.testFile(file) ? undefined : "a root-only package outside a test file";
}

/** Every refused dependency in a cruise result, as "file → specifier: reason". */
export function specifierViolations(result: ICruiseResult, packages: Packages): string[] {
  const out: string[] = [];
  for (const module of result.modules) {
    for (const dependency of module.dependencies) {
      const { module: spec, protocol, coreModule } = dependency;
      const builtin = protocol === "node:";
      const reason = builtin ? undefined : refusal(packages, module.source, spec);
      if (builtin && !coreModule) out.push(`${module.source} → node:${spec}: a node: specifier that is no built-in`);
      if (reason) out.push(`${module.source} → ${spec}: ${reason}`);
    }
  }
  return out;
}
