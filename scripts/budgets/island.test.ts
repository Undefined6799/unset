import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { checkIslands, type IslandBudget, type Manifest, main } from "./island.ts";

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

function run(dir: string): { code: number; lines: string[] } {
  const lines: string[] = [];
  const code = main([dir], ROOT, (line) => lines.push(line));
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
  const { code, lines } = run(dir);
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
  const { code, lines } = run(dir);
  expect(code).toBe(1);
  const errors = lines.filter((line) => line.startsWith("::error"));
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("island src/islands/big.island.tsx");
});

test("island_budget_fails_total_over", () => {
  const islands = ["a", "b", "c", "d", "e", "f"];
  const sizes: Record<string, number> = { "assets/boot-a1.js": 4, "assets/runtime-b2.js": 10 };
  for (const name of islands) sizes[`assets/${name}-c3.js`] = 11;
  const { code, lines } = run(build(manifestOf(islands), sizes));
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
  expect(run(build(dangling, { "assets/boot-a1.js": 1, "assets/runtime-b2.js": 1, "assets/x-c3.js": 1 })).code).toBe(1);
  expect(run(build(manifestOf(["x"]), { "assets/boot-a1.js": 1 })).code).toBe(1); // a listed file is missing
  const noManifest = mkdtempSync(join(tmpdir(), "island-budget-"));
  temps.push(noManifest);
  expect(run(noManifest).code).toBe(1);
  expect(main([], ROOT, () => undefined)).toBe(1);
});
