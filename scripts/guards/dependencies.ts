// Dependency guard (P0.08, plan §6.1): exact pins only, @unset names only as local workspace links,
// every locked package from the public npm registry with a sha512 integrity hash, and the .npmrc fences.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Finding, read } from "./files.ts";

const RULE = "dependencies";
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PINNED_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const INTERNAL_SCOPE = "@unset/";
const REGISTRY = "https://registry.npmjs.org/";
/** Each key's last assignment in .npmrc must hold this value (npm reads the last one). */
const NPMRC_REQUIRED: Record<string, string> = {
  "ignore-scripts": "true",
  "@unset:registry": "https://127.0.0.1:9/",
};

type LockEntry = { link?: boolean; resolved?: string; integrity?: string };
type Lock = { lockfileVersion?: number; packages?: Record<string, LockEntry | null> };
type Manifest = Partial<Record<(typeof PINNED_FIELDS)[number], Record<string, string>>> & { overrides?: unknown };

/** The 1-based line of the first occurrence of `needle`, or 1 when it cannot be found. */
function lineOf(text: string, needle: string): number {
  const at = text.indexOf(needle);
  return at < 0 ? 1 : text.slice(0, at).split("\n").length;
}

/** The name is a workspace and the lockfile links it to that workspace's own folder. */
function isLinkedWorkspace(name: string, workspaces: ReadonlyMap<string, string>, lock: Lock): boolean {
  const entry = lock.packages?.[`node_modules/${name}`];
  return workspaces.has(name) && entry?.link === true && entry.resolved === workspaces.get(name);
}

/** Why a dependency version is not allowed, or null when it is. */
function versionProblem(name: string, version: string, workspaces: ReadonlyMap<string, string>, lock: Lock) {
  const linked = version === "*" && isLinkedWorkspace(name, workspaces, lock);
  if (name.startsWith(INTERNAL_SCOPE)) return linked ? null : "internal name that is not a linked workspace";
  return EXACT.test(version) || linked ? null : "not an exact version";
}

/** Every string value in an `overrides` tree, with its key (`$name` references are npm's own pins). */
function overrideValues(tree: unknown): [string, string][] {
  if (typeof tree !== "object" || tree === null) return [];
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === "string" ? [[key, value]] : overrideValues(value),
  );
}

/** Every disallowed version in one package.json, peer dependencies aside. */
export function scanManifest(
  file: string,
  text: string,
  workspaces: ReadonlyMap<string, string>,
  lock: Lock,
): Finding[] {
  const json = JSON.parse(text) as Manifest;
  const findings: Finding[] = [];
  const add = (field: string, name: string, version: string, why: string): void => {
    const entry = `"${name}": ${JSON.stringify(version)}`;
    findings.push({ file, line: lineOf(text, entry), rule: RULE, text: `${field}: ${entry} (${why})` });
  };
  for (const field of PINNED_FIELDS) {
    for (const [name, version] of Object.entries(json[field] ?? {})) {
      const why = versionProblem(name, version, workspaces, lock);
      if (why) add(field, name, version, why);
    }
  }
  for (const [name, version] of overrideValues(json.overrides)) {
    if (!EXACT.test(version) && !version.startsWith("$")) add("overrides", name, version, "not an exact version");
  }
  return findings;
}

/** Why one installed package's source is not allowed, or null when it is. */
function entryProblem(path: string, entry: LockEntry | null, workspaces: ReadonlyMap<string, string>): string | null {
  if (typeof entry !== "object" || entry === null) return "not an object";
  const name = path.split("node_modules/").at(-1) ?? "";
  if (entry.link === true) {
    // A link fetches nothing, so a hash on one means the entry was hand-edited; and a link must point a name at
    // that workspace's own folder, never a trusted name at another folder (rulings 2026-10-05, P0-A5).
    if (entry.integrity !== undefined) return "link carries an integrity hash";
    return workspaces.get(name) === entry.resolved ? null : `link to ${entry.resolved ?? "nowhere"}`;
  }
  if (name.startsWith(INTERNAL_SCOPE)) return "internal name not linked locally";
  if (!entry.resolved?.startsWith(REGISTRY)) return `resolved ${entry.resolved ?? "missing"}`;
  if (!entry.integrity?.startsWith("sha512-")) return `integrity ${entry.integrity ?? "missing"}`;
  return null;
}

/** Every installed package must be a link to its own workspace folder or come from the npm registry with a sha512 hash. */
export function scanLockfile(file: string, text: string, workspaces: ReadonlyMap<string, string>): Finding[] {
  const lock = JSON.parse(text) as Lock;
  if (lock.lockfileVersion !== 3 || typeof lock.packages !== "object" || lock.packages === null) {
    return [{ file, line: 1, rule: RULE, text: "not a lockfileVersion 3 lockfile with packages" }];
  }
  const findings: Finding[] = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes("node_modules/")) continue; // The root and workspace folders themselves.
    const why = entryProblem(path, entry, workspaces);
    if (why) findings.push({ file, line: lineOf(text, `"${path}"`), rule: RULE, text: `${path}: ${why}` });
  }
  return findings;
}

/** The .npmrc settings that keep install scripts off and the @unset scope local. */
export function scanNpmrc(file: string, text: string): Finding[] {
  const last = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) last.set(m[1], m[2]);
  }
  return Object.entries(NPMRC_REQUIRED)
    .filter(([key, value]) => last.get(key) !== value)
    .map(([key, value]) => ({ file, line: 1, rule: RULE, text: `${key} must end as ${value}` }));
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
  const manifests = ["package.json", ...[...workspaces.values()].map((dir) => `${dir}/package.json`)];
  return [
    ...manifests.flatMap((file) => scanManifest(file, read(root, file), workspaces, lock)),
    ...scanLockfile("package-lock.json", lockText, workspaces),
    ...scanNpmrc(".npmrc", read(root, ".npmrc")),
  ];
}
