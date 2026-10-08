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
import { join } from "node:path";
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
};

const declared = (manifest: Manifest): Set<string> =>
  new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);

/** Reads the root package.json and every workspace it lists (`dir/*` patterns, as this repo writes them). */
export function readPackages(root: string, list: (dir: string) => string[]): Packages {
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
  return { rootName: top.name ?? "", root: declared(top), workspaces };
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
  const workspaces = [...packages.workspaces.values()];
  if (bare.name.startsWith("@unset/")) {
    return workspaces.some((w) => w.name === bare.name) ? undefined : "an @unset name that is no workspace";
  }
  // Amendment 2: the importing file's own workspace, or the root package.json (which root-level files use).
  if (owner(packages, file)?.has(bare.name) || packages.root.has(bare.name)) return undefined;
  return "a package neither its workspace nor the root package.json declares";
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
