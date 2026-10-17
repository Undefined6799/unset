import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { type CssBudget, checkCss, main, measureBundles } from "./css.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const KIB = 1024;
const BUDGET: CssBudget = JSON.parse(readFileSync(join(ROOT, "scripts", "budgets", "budget.css.json"), "utf8"));

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "css-budget-"));
  temps.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/** About `bytes` of CSS that gzip cannot squeeze to nothing: distinct class names and values. */
function css(bytes: number, seed: string): string {
  const rules: string[] = [];
  for (let i = 0, size = 0; size < bytes; i++) {
    const rule = `.${seed}${i.toString(36)}{margin:${(i * 7919) % 997}px ${(i * 104729) % 991}px}\n`;
    rules.push(rule);
    size += rule.length;
  }
  return rules.join("").slice(0, bytes);
}

/** A minified and an unminified build of the same bundles, as Vite names them (`<name>-<hash>.css`). */
function builds(bundles: Record<string, number>): { min: string; raw: string } {
  const entries = Object.entries(bundles);
  const min = tree(
    Object.fromEntries(entries.map(([name, kib]) => [`assets/${name}-AbC123x_.css`, css(kib * KIB * 0.8, name)])),
  );
  const raw = tree(
    Object.fromEntries(entries.map(([name, kib]) => [`assets/${name}-Zz9_8-yQ.css`, css(kib * KIB, name)])),
  );
  return { min, raw };
}

test("budget_css_limits_are_kib", () => {
  expect(BUDGET).toEqual({
    perBundle: { unminifiedBytes: 40 * KIB, minGzipBytes: 12 * KIB },
    perPage: { unminifiedBytes: 40 * KIB, minGzipBytes: 12 * KIB },
  });
});

test("css_budget_over", () => {
  const { min, raw } = builds({ big: 41, small: 2 });
  const bundles = measureBundles(min, raw);
  expect(bundles.map((b) => [b.name, b.unminifiedBytes])).toEqual([
    ["assets/big.css", 41 * KIB],
    ["assets/small.css", 2 * KIB],
  ]);
  const report = checkCss(bundles, {}, BUDGET);
  expect(report.over).toEqual([
    expect.stringMatching(
      /^bundle assets\/big\.css: 41984 unminified bytes \(max 40960\), \d+ min-gzip bytes \(max 12288\)$/,
    ),
  ]);
  // The numbers are printed for every bundle, over or not.
  expect(report.lines).toEqual([
    expect.stringMatching(/^bundle assets\/big\.css: 41984 /),
    expect.stringMatching(/^bundle assets\/small\.css: 2048 /),
  ]);
});

test("css_budget_per_page_over", () => {
  const { min, raw } = builds({ a: 15, b: 15, c: 15, d: 1 });
  const bundles = measureBundles(min, raw);
  const pages = { "/": ["assets/a.css", "assets/b.css", "assets/c.css"], "/about": ["assets/a.css", "assets/d.css"] };
  const report = checkCss(bundles, pages, BUDGET);
  expect(report.over).toEqual([expect.stringMatching(/^page \/: 46080 unminified bytes \(max 40960\), /)]);
  expect(checkCss(bundles, { "/x": ["assets/nope.css"] }, BUDGET).over).toEqual([
    "page /x links assets/nope.css, which no build produced",
  ]);
});

test("css_budget_builds_must_pair", () => {
  const min = tree({ "assets/a-AbC123x_.css": "a{}" });
  const raw = tree({ "assets/b-AbC123x_.css": "b{}" });
  expect(() => measureBundles(min, raw)).toThrow("assets/a.css is in one build only");
});

test("css_budget_cli_exit_codes", () => {
  const over = builds({ big: 41 });
  const lines: string[] = [];
  expect(main([over.min, over.raw], ROOT, (l) => lines.push(l))).toBe(1);
  expect(lines.at(-1)).toMatch(/^::error title=css-budget::bundle assets\/big\.css: /);
  const ok = builds({ small: 1 });
  expect(main([ok.min, ok.raw], ROOT, () => undefined)).toBe(0);
  expect(main([], ROOT, () => undefined)).toBe(1);
});

// apps/web does not exist until P1.23, so there are no real bundles yet; this measures the empty set and becomes a
// real check once P1.21 wires the Vite double build into `npm run budgets`.
test("css_budget_current", () => {
  const empty = { min: tree({}), raw: tree({}) };
  expect(checkCss(measureBundles(empty.min, empty.raw), {}, BUDGET)).toEqual({ lines: [], over: [] });
});
