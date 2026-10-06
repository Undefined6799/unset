// CSS size budget (P1.21q; plan §6.1 CSS row and §8 Phase 1 styling paragraph): every bundle and every page stays
// under budget.css.json, measured two ways. Unminified bytes come from a build with minification off; min-gzip
// bytes are gzip level 9 of the minified build. Limits are KiB (P1.21: 40 KiB = 40,960 bytes). Unlike the line
// budgets this is a gate: anything over exits 1, and the numbers are printed every time.
//
// The two builds are paired by file name with Vite's content hash removed (`assets/[name]-[hash][extname]`, the
// default asset name in the Vite build options docs). That naming is unverified until P1.21 wires the real double
// build into `npm run budgets`; until then a bundle found in one build only is an error, never a silent pass.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export type CssLimits = { unminifiedBytes: number; minGzipBytes: number };
export type CssBudget = { perBundle: CssLimits; perPage: CssLimits };
export type BundleSize = { name: string; unminifiedBytes: number; minGzipBytes: number };
/** Each page path and the bundle names (hash removed) of the stylesheets the server links on it. */
export type PageStyles = Record<string, string[]>;
export type CssReport = { lines: string[]; over: string[] };

const HASH = /-[\w-]{8}(?=\.css$)/;

/** Every .css file under `dir`, keyed by its path relative to `dir` with the content hash removed. */
function cssFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".css")) files.set(relative(dir, path).split(sep).join("/").replace(HASH, ""), path);
    }
  };
  walk(dir);
  return files;
}

/** Both measures for every bundle, sorted by name; a bundle in one build only is an error. */
export function measureBundles(minifiedDir: string, unminifiedDir: string): BundleSize[] {
  const minified = cssFiles(minifiedDir);
  const unminified = cssFiles(unminifiedDir);
  for (const name of new Set([...minified.keys(), ...unminified.keys()])) {
    if (!minified.has(name) || !unminified.has(name)) throw new Error(`${name} is in one build only`);
  }
  return [...minified.keys()].sort().map((name) => ({
    name,
    unminifiedBytes: statSync(unminified.get(name) ?? "").size,
    minGzipBytes: gzipSync(readFileSync(minified.get(name) ?? ""), { level: 9 }).length,
  }));
}

function line(what: string, size: CssLimits, limits: CssLimits): { text: string; over: boolean } {
  const text =
    `${what}: ${size.unminifiedBytes} unminified bytes (max ${limits.unminifiedBytes}), ` +
    `${size.minGzipBytes} min-gzip bytes (max ${limits.minGzipBytes})`;
  return { text, over: size.unminifiedBytes > limits.unminifiedBytes || size.minGzipBytes > limits.minGzipBytes };
}

/** Every bundle and every page against the budget; a page linking a bundle no build produced is over. */
export function checkCss(bundles: BundleSize[], pages: PageStyles, budget: CssBudget): CssReport {
  const byName = new Map(bundles.map((b) => [b.name, b]));
  const results = bundles.map((b) => line(`bundle ${b.name}`, b, budget.perBundle));
  const over: string[] = [];
  for (const [page, names] of Object.entries(pages)) {
    const missing = names.find((name) => !byName.has(name));
    if (missing !== undefined) {
      over.push(`page ${page} links ${missing}, which no build produced`);
      continue;
    }
    const linked = names.map((name) => byName.get(name) as BundleSize);
    const sum = (key: keyof CssLimits) => linked.reduce((total, b) => total + b[key], 0);
    results.push(
      line(
        `page ${page}`,
        { unminifiedBytes: sum("unminifiedBytes"), minGzipBytes: sum("minGzipBytes") },
        budget.perPage,
      ),
    );
  }
  return { lines: results.map((r) => r.text), over: [...results.filter((r) => r.over).map((r) => r.text), ...over] };
}

/** `css.ts <minified dir> <unminified dir> [pages.json]`: 0 when everything is within budget, else 1. */
export function main(args: string[], root: string, print: (line: string) => void): number {
  const [minifiedDir, unminifiedDir, pagesFile] = args;
  if (minifiedDir === undefined || unminifiedDir === undefined) {
    print("::error title=css-budget::usage: css.ts <minified dir> <unminified dir> [pages.json]");
    return 1;
  }
  try {
    const budget: CssBudget = JSON.parse(readFileSync(join(root, "scripts/budgets/budget.css.json"), "utf8"));
    const pages: PageStyles = pagesFile === undefined ? {} : JSON.parse(readFileSync(pagesFile, "utf8"));
    const report = checkCss(measureBundles(minifiedDir, unminifiedDir), pages, budget);
    for (const text of report.lines) print(text);
    for (const text of report.over) print(`::error title=css-budget::${text}`);
    return report.over.length === 0 ? 0 : 1;
  } catch (error) {
    print(`::error title=css-budget::${String(error)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), join(import.meta.dirname, "..", ".."), console.log);
}
