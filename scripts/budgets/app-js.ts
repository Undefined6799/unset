// App page JS budget on the SvelteKit build (plan §6.1 "App pages" row; Alex, 2026-11-18T04:18:09Z: "increasing the
// target to 120 ... it should not be like a strict barrier, but more like of a warning"). The client is one bundle
// (interfaces/web/vite.config.ts `output.bundleStrategy: "single"`), so an app page loads every .js file under _app/immutable once:
// their gzip level 9 total is what is measured. Unlike the CSS and island budgets this never fails: over the warning
// line it prints a GitHub Actions `::warning::` annotation (docs.github.com/actions, "Workflow commands", "Setting a
// warning message") and still exits 0. Public, sign-in and blocked pages load no script; Lighthouse checks that.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export type AppJsBudget = { warnGzipBytes: number };
export type AppJsReport = { lines: string[]; warning?: string };

const IMMUTABLE = join("_app", "immutable");

/** Every .js file under `dir`, relative to it, sorted. */
function jsFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".js")) found.push(relative(dir, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return found.sort();
}

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;

/** The per-file and total gzip sizes of the client under `clientDir`, and a warning when the total passes the line. */
export function appJsReport(clientDir: string, budget: AppJsBudget): AppJsReport {
  const dir = join(clientDir, IMMUTABLE);
  const files = existsSync(dir) ? jsFiles(dir) : [];
  if (files.length === 0) throw new Error(`no .js files under ${dir}: build interfaces/web first`);
  let total = 0;
  const lines = files.map((file) => {
    const bytes = gzipSync(readFileSync(join(dir, file)), { level: 9 }).length;
    total += bytes;
    return `  ${file}: ${kib(bytes)} gzip`;
  });
  lines.push(`app page JS: ${kib(total)} gzip (warns above ${kib(budget.warnGzipBytes)})`);
  if (total <= budget.warnGzipBytes) return { lines };
  const warning = `App page JS is ${kib(total)} gzip, above the ${kib(budget.warnGzipBytes)} target (plan §6.1)`;
  return { lines, warning };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const clientDir = process.argv[2] ?? "interfaces/web/build/client";
  const budget = JSON.parse(readFileSync(new URL("./budget.app-js.json", import.meta.url), "utf8")) as AppJsBudget;
  const report = appJsReport(clientDir, budget);
  for (const line of report.lines) console.log(line);
  if (report.warning !== undefined) console.log(`::warning title=App JS budget::${report.warning}`);
}
