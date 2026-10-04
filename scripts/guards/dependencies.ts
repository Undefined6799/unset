// Dependency guard (P0.08, plan §6.1): exact pins only, @unset names only as local workspace links,
// every locked package from the public npm registry with a sha512 integrity hash, and the .npmrc fences.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Finding, read } from "./files.ts";

const RULE = "dependencies";
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PINNED_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const REGISTRY = "https://registry.npmjs.org/";
const NPMRC_LINES = ["ignore-scripts=true", "@unset:registry=https://127.0.0.1:9/"];

type LockEntry = { link?: boolean; resolved?: string; integrity?: string };
type Lock = { packages?: Record<string, LockEntry> };

/** The 1-based line of the first occurrence of `needle`, or 1 when it cannot be found. */
function lineOf(text: string, needle: string): number {
  const at = text.indexOf(needle);
  return at < 0 ? 1 : text.slice(0, at).split("\n").length;
}

/** A `"*"` is a workspace link only when the name is a workspace and the lockfile links it locally. */
function isLinkedWorkspace(name: string, workspaces: ReadonlySet<string>, lock: Lock): boolean {
  return workspaces.has(name) && lock.packages?.[`node_modules/${name}`]?.link === true;
}

/** Every non-exact version in one package.json, peer dependencies aside. */
export function scanManifest(file: string, text: string, workspaces: ReadonlySet<string>, lock: Lock): Finding[] {
  const json = JSON.parse(text) as Partial<Record<(typeof PINNED_FIELDS)[number], Record<string, string>>>;
  const findings: Finding[] = [];
  for (const field of PINNED_FIELDS) {
    for (const [name, version] of Object.entries(json[field] ?? {})) {
      if (EXACT.test(version)) continue;
      if (version === "*" && isLinkedWorkspace(name, workspaces, lock)) continue;
      const entry = `"${name}": ${JSON.stringify(version)}`;
      findings.push({ file, line: lineOf(text, entry), rule: RULE, text: `${field}: ${entry}` });
    }
  }
  return findings;
}

/** Every installed package that is not a local link must come from the npm registry with a sha512 hash. */
export function scanLockfile(file: string, text: string): Finding[] {
  const lock = JSON.parse(text) as Lock;
  const findings: Finding[] = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.includes("node_modules/") || entry.link === true) continue;
    const fromRegistry = entry.resolved?.startsWith(REGISTRY) ?? false;
    const hashed = entry.integrity?.startsWith("sha512-") ?? false;
    if (fromRegistry && hashed) continue;
    const why = fromRegistry ? `integrity ${entry.integrity ?? "missing"}` : `resolved ${entry.resolved ?? "missing"}`;
    findings.push({ file, line: lineOf(text, `"${path}"`), rule: RULE, text: `${path}: ${why}` });
  }
  return findings;
}

/** The two .npmrc lines that keep install scripts off and the @unset scope local. */
export function scanNpmrc(file: string, text: string): Finding[] {
  const lines = new Set(text.split("\n").map((l) => l.trim()));
  return NPMRC_LINES.filter((l) => !lines.has(l)).map((l) => ({ file, line: 1, rule: RULE, text: `missing ${l}` }));
}

/** Workspace package name → its folder, from the root package.json `workspaces` globs (`dir/*` only). */
export function workspaceNames(root: string): Map<string, string> {
  const globs = (JSON.parse(read(root, "package.json")) as { workspaces?: string[] }).workspaces ?? [];
  const out = new Map<string, string>();
  for (const glob of globs) {
    const parent = glob.replace(/\/\*$/, "");
    let dirs: string[];
    try {
      dirs = readdirSync(join(root, parent), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `${parent}/${d.name}`);
    } catch {
      continue; // Folders appear with their first code (decision 34).
    }
    for (const dir of dirs) {
      try {
        const name = (JSON.parse(read(root, `${dir}/package.json`)) as { name?: string }).name;
        if (name) out.set(name, dir);
      } catch {
        // A folder without a package.json is not a workspace.
      }
    }
  }
  return out;
}

/** The root and every workspace manifest, the lockfile and .npmrc. */
export function scanAll(root: string): Finding[] {
  const lockText = read(root, "package-lock.json");
  const lock = JSON.parse(lockText) as Lock;
  const workspaces = workspaceNames(root);
  const names = new Set(workspaces.keys());
  const manifests = ["package.json", ...[...workspaces.values()].map((dir) => `${dir}/package.json`)];
  return [
    ...manifests.flatMap((file) => scanManifest(file, read(root, file), names, lock)),
    ...scanLockfile("package-lock.json", lockText),
    ...scanNpmrc(".npmrc", read(root, ".npmrc")),
  ];
}
