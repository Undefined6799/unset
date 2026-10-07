import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, expect, test } from "vitest";
import {
  checkIslands,
  ISLAND_ROOTS,
  type IslandBudget,
  islandSources,
  islandsAreLazyChunks,
  type Manifest,
  main,
} from "./island.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const KIB = 1024;
const BUDGET: IslandBudget = JSON.parse(readFileSync(join(ROOT, "scripts", "budgets", "budget.island.json"), "utf8"));

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A build directory with a Vite manifest and JS files of about `kib` gzipped KiB each (random bytes do not shrink). */
function build(manifest: Manifest, sizes: Record<string, number>): string {
  const root = mkdtempSync(join(tmpdir(), "island-budget-"));
  temps.push(root);
  const files = { ".vite/manifest.json": JSON.stringify(manifest) };
  for (const [file, kib] of Object.entries(sizes)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), randomBytes(Math.round(kib * KIB)));
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/** A bootstrap entry that imports a shared runtime and loads each island dynamically, as P1.23's build will. */
function manifestOf(islands: string[]): Manifest {
  const manifest: Manifest = {
    "src/boot.ts": {
      file: "assets/boot-a1.js",
      src: "src/boot.ts",
      isEntry: true,
      imports: ["_runtime.js"],
      dynamicImports: islands.map((name) => `src/islands/${name}.island.tsx`),
    },
    "_runtime.js": { file: "assets/runtime-b2.js" },
  };
  for (const name of islands) {
    manifest[`src/islands/${name}.island.tsx`] = {
      file: `assets/${name}-c3.js`,
      src: `src/islands/${name}.island.tsx`,
      isDynamicEntry: true,
      imports: ["_runtime.js"],
    };
  }
  return manifest;
}

/** The source list `manifestOf(islands)` was built from, in the manifest's own terms. */
const sourcesOf = (islands: string[]): string[] => islands.map((name) => `src/islands/${name}.island.tsx`);

function run(dir: string, islands: string[] = []): { code: number; lines: string[] } {
  const lines: string[] = [];
  const code = main([dir], ROOT, (line) => lines.push(line), islands);
  return { code, lines };
}

test("budget_island_limits_are_kib", () => {
  expect(BUDGET).toEqual({ perIslandGzipBytes: 15 * KIB, totalGzipBytes: 75 * KIB });
});

test("island_budget_passes_within_limits", () => {
  const dir = build(manifestOf(["demo", "menu"]), {
    "assets/boot-a1.js": 4,
    "assets/runtime-b2.js": 30,
    "assets/demo-c3.js": 10,
    "assets/menu-c3.js": 12,
  });
  const { code, lines } = run(dir, sourcesOf(["demo", "menu"]));
  expect(code).toBe(0);
  expect(lines.filter((line) => line.startsWith("island "))).toHaveLength(2);
  expect(lines.at(-1)).toMatch(/^all island JS: \d+ gzip bytes in 4 files \(max 76800\)$/);
});

test("island_budget_check", () => {
  const dir = build(manifestOf(["demo", "big"]), {
    "assets/boot-a1.js": 2,
    "assets/runtime-b2.js": 10,
    "assets/demo-c3.js": 5,
    "assets/big-c3.js": 16,
  });
  const { code, lines } = run(dir, sourcesOf(["demo", "big"]));
  expect(code).toBe(1);
  const errors = lines.filter((line) => line.startsWith("::error"));
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("island src/islands/big.island.tsx");
});

test("island_budget_fails_total_over", () => {
  const islands = ["a", "b", "c", "d", "e", "f"];
  const sizes: Record<string, number> = { "assets/boot-a1.js": 4, "assets/runtime-b2.js": 10 };
  for (const name of islands) sizes[`assets/${name}-c3.js`] = 11;
  const { code, lines } = run(build(manifestOf(islands), sizes), sourcesOf(islands));
  expect(code).toBe(1);
  expect(lines.filter((line) => line.startsWith("::error"))).toEqual([
    expect.stringMatching(/^::error title=island-budget::all island JS: \d+ gzip bytes in 8 files/),
  ]);
});

test("island_budget_counts_shared_chunk_once", () => {
  const gz: Record<string, number> = { "assets/boot-a1.js": 100, "assets/runtime-b2.js": 1000, "assets/x-c3.js": 10 };
  const report = checkIslands(manifestOf(["x"]), (file) => gz[file] ?? 0, BUDGET);
  expect(report.lines.at(-1)).toBe("all island JS: 1110 gzip bytes in 3 files (max 76800)");
});

test("island_budget_fails_closed", () => {
  expect(run(build({}, {})).code).toBe(1); // no entry chunk
  const dangling = manifestOf(["x"]);
  dangling["src/boot.ts"]?.imports?.push("_missing.js");
  const x = sourcesOf(["x"]);
  expect(run(build(dangling, { "assets/boot-a1.js": 1, "assets/runtime-b2.js": 1, "assets/x-c3.js": 1 }), x).code).toBe(
    1,
  );
  expect(run(build(manifestOf(["x"]), { "assets/boot-a1.js": 1 }), x).code).toBe(1); // a listed file is missing
  const noManifest = mkdtempSync(join(tmpdir(), "island-budget-"));
  temps.push(noManifest);
  expect(run(noManifest).code).toBe(1);
  expect(main([], ROOT, () => undefined)).toBe(1);
});

// P1.25l (book edit 2026-10-07-p125l-islands-lazy-chunks): #464's first build inlined islands into boot and the size
// budget silently counted fewer, so every island in the source list must keep its own lazy chunk.
test("islands_are_lazy_chunks", () => {
  const islands = sourcesOf(["demo", "menu"]);
  expect(islandsAreLazyChunks(manifestOf(["demo", "menu"]), islands)).toEqual([]);

  const inlined = manifestOf(["demo", "menu"]);
  inlined["src/boot.ts"]?.imports?.push("src/islands/menu.island.tsx"); // the #464 shape
  expect(islandsAreLazyChunks(inlined, islands)).toEqual([
    "island src/islands/menu.island.tsx is statically imported by entry src/boot.ts",
  ]);

  const missing = manifestOf(["demo"]);
  expect(islandsAreLazyChunks(missing, islands)).toEqual([
    "island src/islands/menu.island.tsx has no chunk of its own",
  ]);

  const entry = manifestOf(["demo", "menu"]);
  const menu = entry["src/islands/menu.island.tsx"];
  if (menu !== undefined) menu.isEntry = true;
  expect(islandsAreLazyChunks(entry, islands)).toEqual([
    "island src/islands/menu.island.tsx is not a dynamic entry only (isDynamicEntry true, isEntry false)",
  ]);
});

test("islands_are_lazy_chunks_refuse_in_main", () => {
  const sizes = { "assets/boot-a1.js": 1, "assets/runtime-b2.js": 1, "assets/demo-c3.js": 1 };
  const { code, lines } = run(build(manifestOf(["demo"]), sizes), sourcesOf(["demo", "menu"]));
  expect(code).toBe(1);
  expect(lines).toEqual(["::error title=island-budget::island src/islands/menu.island.tsx has no chunk of its own"]);
});

test("island_sources_lists_every_island", () => {
  const tracked = execFileSync("git", ["ls-files", "*.island.tsx"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => file !== "");
  expect(tracked.length).toBeGreaterThan(0);
  for (const file of tracked)
    expect(
      ISLAND_ROOTS.some((root) => file.startsWith(`${root}/`)),
      file,
    ).toBe(true);
  const viteRoot = join(ROOT, "apps", "web");
  const expected = tracked.map((file) => relative(viteRoot, join(ROOT, file))).sort();
  expect(islandSources(ROOT)).toEqual(expected);
});
