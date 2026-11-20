// App page JS budget on the SvelteKit build (plan §6.1 "App pages" row; Alex, 2026-11-18T04:18:09Z: "increasing the
// target to 120 ... it should not be like a strict barrier, but more like of a warning"). The client is split
// (interfaces/web/vite.config.ts `output.bundleStrategy: "split"`, P1.21g): a cold app page loads SvelteKit's start
// files and the pieces its layouts and page import, so each page route is measured on its own, as the gzip level 9
// total of those files, and the heaviest is held to the line. Kit 3.2.0 writes both lists into the server build:
// `client.imports` in build/server/manifest.js and `export const imports` in each build/server/nodes/<n>.js, the files
// the page links as modulepreload; each route there names its layouts and leaf node. Unlike the CSS and island budgets
// this never fails: over the line it prints a GitHub Actions `::warning::` annotation (docs.github.com/actions,
// "Workflow commands", "Setting a warning message") and still exits 0. Public, sign-in and blocked pages load no
// script; Lighthouse checks that.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export type AppJsBudget = { warnGzipBytes: number };
export type AppJsReport = { lines: string[]; warning?: string };

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;
/** A JSON array of strings written into the build's code, read without running that code. */
const strings = (text: string | undefined, what: string): string[] => {
  if (text === undefined) throw new Error(`no ${what} in the server build: build interfaces/web first`);
  return JSON.parse(text) as string[];
};
/** Each page route's id and the nodes it loads: its layouts, then its leaf. */
const ROUTE =
  /id: "([^"]+)",(?:(?!id: ")[\s\S])*?page: \{ layouts: \[([\d,\s]*)\], errors: \[[\d,\s]*\], leaf: (\d+) \}/g;

/** The gzip total of the JS each page route under `buildDir` loads cold, heaviest first, and a warning past the line. */
export function appJsReport(buildDir: string, budget: AppJsBudget): AppJsReport {
  const server = join(buildDir, "server");
  const manifest = readFileSync(join(server, "manifest.js"), "utf8");
  const start = strings(/client: \{[^}]*?imports:(\[[^\]]*\])/.exec(manifest)?.[1], "client.imports");
  const nodeFiles = (node: string): string[] =>
    strings(
      /export const imports = (\[[^\]]*\]);/.exec(readFileSync(join(server, "nodes", `${node}.js`), "utf8"))?.[1],
      `imports for node ${node}`,
    );
  const sizes = new Map<string, number>();
  const gzip = (file: string): number => {
    const known = sizes.get(file);
    if (known !== undefined) return known;
    const bytes = gzipSync(readFileSync(join(buildDir, "client", file)), { level: 9 }).length;
    sizes.set(file, bytes);
    return bytes;
  };
  const routes = [...manifest.matchAll(ROUTE)].map(([, id = "", layouts = "", leaf = ""]) => {
    const nodes = [...layouts.split(",").filter((n) => n.trim() !== ""), leaf].map((n) => n.trim());
    const files = new Set([...start, ...nodes.flatMap(nodeFiles)].filter((file) => file.endsWith(".js")));
    return { id, files: files.size, bytes: [...files].reduce((total, file) => total + gzip(file), 0) };
  });
  if (routes.length === 0)
    throw new Error(`no page routes in ${join(server, "manifest.js")}: build interfaces/web first`);
  routes.sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1));
  const lines = routes.map((route) => `  ${route.id}: ${kib(route.bytes)} gzip in ${route.files} files`);
  const [heaviest] = routes as [(typeof routes)[number], ...unknown[]];
  lines.push(`app page JS: ${kib(heaviest.bytes)} gzip on ${heaviest.id} (warns above ${kib(budget.warnGzipBytes)})`);
  if (heaviest.bytes <= budget.warnGzipBytes) return { lines };
  const warning = `App page JS is ${kib(heaviest.bytes)} gzip on ${heaviest.id}, above the ${kib(budget.warnGzipBytes)} target (plan §6.1)`;
  return { lines, warning };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const buildDir = process.argv[2] ?? "interfaces/web/build";
  const budget = JSON.parse(readFileSync(new URL("./budget.app-js.json", import.meta.url), "utf8")) as AppJsBudget;
  const report = appJsReport(buildDir, budget);
  for (const line of report.lines) console.log(line);
  if (report.warning !== undefined) console.log(`::warning title=App JS budget::${report.warning}`);
}
