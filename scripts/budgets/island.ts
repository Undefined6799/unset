// Island JS budget (P1.23q; plan §6.1 JS row; step book P1.23 "island-budget"): after the build, each island chunk is
// at most 15 KB gzipped, and the bootstrap, the shared runtime and every island together at most 75 KB. Like the CSS
// budget this is a gate: anything over exits 1, and the numbers are printed every time.
//
// The build is read through Vite's manifest (vite 8.3.1: `build.manifest: true` writes `.vite/manifest.json` in the
// output directory, dist/node/chunks/node.js; entries are `ManifestChunk`, dist/node/index.d.ts). An island is a
// chunk whose `src` ends in `.island.tsx`; the total is every JS file reachable from the entry chunks through
// `imports` and `dynamicImports`, each counted once.
//
// Before the size gate, every island in the source tree must keep its own lazy chunk (P1.25l; book edit
// 2026-10-07-p125l-islands-lazy-chunks; plan §5.1). The manifest alone cannot show an island inlined into boot, which
// has no chunk and is simply not counted (#464's first build), so the islands found on disk are checked against it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export type IslandBudget = { perIslandGzipBytes: number; totalGzipBytes: number };
/** The fields of Vite's ManifestChunk this budget reads. */
export type ManifestChunk = {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
};
export type Manifest = Record<string, ManifestChunk>;
export type IslandReport = { lines: string[]; over: string[] };

const MANIFEST = ".vite/manifest.json";
/** The Vite root of the web build: a manifest `src` is relative to it (apps/web/vite.config.ts; ci.yml builds it). */
const VITE_ROOT = "apps/web";
/** Where islands live, as the depcruise island rule names them (scripts/lint/.dependency-cruiser.cjs, `ISLAND`). */
export const ISLAND_ROOTS = ["apps/web/src/islands", "shared/ui/islands"];
const ISLAND = /\.island\.tsx$/;
const JS = /\.m?js$/;

/** Every manifest key reachable from the entry chunks; a key that names no chunk is an error, never a skip. */
function reachable(manifest: Manifest): string[] {
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    const chunk = manifest[key];
    if (chunk === undefined) throw new Error(`manifest key ${key} is imported but not listed`);
    seen.add(key);
    for (const next of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) visit(next);
  };
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
  return [...seen].sort();
}

/** Every `*.island.tsx` under the island roots, relative to the Vite root as the manifest names it. */
export function islandSources(root: string): string[] {
  const viteRoot = join(root, VITE_ROOT);
  const found: string[] = [];
  for (const islandRoot of ISLAND_ROOTS) {
    const dir = join(root, islandRoot);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (ISLAND.test(file)) found.push(relative(viteRoot, join(dir, file)));
    }
  }
  return found.sort();
}

/** The manifest keys an entry loads before anything runs: its `imports`, transitively, never `dynamicImports`. */
function staticClosure(manifest: Manifest, entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const next of manifest[key]?.imports ?? []) visit(next);
  };
  visit(entry);
  return seen;
}

/** One refusal per island that is missing, not a lazy-only chunk, or statically reachable from an entry. */
export function islandsAreLazyChunks(manifest: Manifest, islands: string[]): string[] {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true);
  const closures = entries.map((entry) => ({ entry, keys: staticClosure(manifest, entry) }));
  const refusals: string[] = [];
  for (const island of islands) {
    const key = Object.keys(manifest).find((candidate) => manifest[candidate]?.src === island);
    const chunk = key === undefined ? undefined : manifest[key];
    if (key === undefined || chunk === undefined) {
      refusals.push(`island ${island} has no chunk of its own`);
      continue;
    }
    if (chunk.isDynamicEntry !== true || chunk.isEntry === true) {
      refusals.push(`island ${island} is not a dynamic entry only (isDynamicEntry true, isEntry false)`);
      continue;
    }
    for (const { entry, keys } of closures) {
      if (entry !== key && keys.has(key)) refusals.push(`island ${island} is statically imported by entry ${entry}`);
    }
  }
  return refusals;
}

/** Each island chunk against the per-island limit, and every reachable JS file together against the total. */
export function checkIslands(
  manifest: Manifest,
  gzipBytes: (file: string) => number,
  budget: IslandBudget,
): IslandReport {
  const keys = reachable(manifest);
  if (keys.length === 0) throw new Error("the manifest has no entry chunk");
  const lines: string[] = [];
  const over: string[] = [];
  const files = new Set<string>();
  for (const key of keys) {
    const chunk = manifest[key] as ManifestChunk;
    if (!JS.test(chunk.file)) continue;
    files.add(chunk.file);
    if (!ISLAND.test(chunk.src ?? key)) continue;
    const text = `island ${chunk.src ?? key}: ${gzipBytes(chunk.file)} gzip bytes (max ${budget.perIslandGzipBytes})`;
    lines.push(text);
    if (gzipBytes(chunk.file) > budget.perIslandGzipBytes) over.push(text);
  }
  const total = [...files].reduce((sum, file) => sum + gzipBytes(file), 0);
  const text = `all island JS: ${total} gzip bytes in ${files.size} files (max ${budget.totalGzipBytes})`;
  lines.push(text);
  if (total > budget.totalGzipBytes) over.push(text);
  return { lines, over };
}

/** `island.ts <build dir>`: 0 when every island is a lazy chunk and everything is within budget, else 1. */
export function main(
  args: string[],
  root: string,
  print: (line: string) => void,
  islands: string[] = islandSources(root),
): number {
  const [buildDir] = args;
  if (buildDir === undefined) {
    print("::error title=island-budget::usage: island.ts <build dir>");
    return 1;
  }
  try {
    const budget: IslandBudget = JSON.parse(readFileSync(join(root, "scripts/budgets/budget.island.json"), "utf8"));
    const manifestPath = join(buildDir, MANIFEST);
    if (!existsSync(manifestPath)) throw new Error(`${MANIFEST} not found in ${buildDir}`);
    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const refusals = islandsAreLazyChunks(manifest, islands);
    for (const text of refusals) print(`::error title=island-budget::${text}`);
    if (refusals.length > 0) return 1;
    const gzipBytes = (file: string) => gzipSync(readFileSync(join(buildDir, file)), { level: 9 }).length;
    const report = checkIslands(manifest, gzipBytes, budget);
    for (const text of report.lines) print(text);
    for (const text of report.over) print(`::error title=island-budget::${text}`);
    return report.over.length === 0 ? 0 : 1;
  } catch (error) {
    print(`::error title=island-budget::${String(error)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), join(import.meta.dirname, "..", ".."), console.log);
}
