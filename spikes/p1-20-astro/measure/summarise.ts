// Turns the Astro raw reports into MEASUREMENTS.json with the same fields as the Hono candidate.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { cssMapMismatches } from "../../../scripts/docs/glue-spike.ts";

const raw = (f: string) => JSON.parse(readFileSync(`measure/out/raw/${f}`, "utf8"));
type Page = { url: string; console: { text: string }[]; pageErrors: string[]; scriptBytes: number };
const page = (r: { pages: Page[] }, p: string) => r.pages.find((x) => new URL(x.url).pathname === p) as Page;
const msgs = (p: Page) => [...p.console.map((m) => m.text), ...p.pageErrors];
const csp = (t: string) => t.includes("Content Security Policy") || t.includes("Trusted Type");
const styleAttr = (t: string) => t.includes("Content Security Policy") && t.includes("inline style");

const prod = raw("chromium-prod.json");
const open = raw("chromium-prod-no-csp.json");
const html: Record<string, string> = raw("prod-html.json");
const inline = [...(html["/"] ?? "").matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
const gz = raw("gzip.json").bytes as Record<string, number>;
const pick = (prefix: string) => Object.entries(gz).filter(([f]) => f.startsWith(prefix)).reduce((s, [, b]) => s + b, 0);
const reactRuntime = pick("client.") + pick("react.");
const bootstrap = gzipSync(inline.join("\n"), { level: 9 }).length;
const box = pick("Box.");
const perIsland = { Counter: pick("Counter.") + box, Search: pick("Search.") + box };
const maps = raw("css-maps-prod.json") as Record<string, Record<string, string>[]>;
const mismatches = Object.entries(maps).flatMap(([file, list]) =>
  list.slice(1).flatMap((m) => cssMapMismatches({ [file]: list[0] ?? {} }, { [file]: m })),
);
const glue = raw("glue.json");
const config = Object.values(glue.configs as Record<string, { functionLines: number; declarativeLines: number }>)
  .reduce((s, c) => s + c.functionLines + Math.max(0, c.declarativeLines - 80), 0);
const middleware = glue.files["src/middleware.ts"] as number;
const hydration = (r: { pages: Page[] }) => r.pages.flatMap(msgs).filter((t) => /hydrat/i.test(t)).length;
const deps = raw("deps.json");
const seconds = (raw("build-stats.json").cleanBuildSeconds as number[]).toSorted((a, b) => a - b);

const measurements = {
  candidate: "astro",
  versions: deps.versions,
  ssrRenderer: "@astrojs/react (react-dom/server) through Astro pages",
  glueLines: { devSsr: 0, manifest: 0, css: 0, islands: 0, serialiser: 0, shell: middleware, config, total: middleware + config },
  declarativeConfigLines: Object.values(glue.configs as Record<string, { declarativeLines: number }>)[0]?.declarativeLines,
  cssIdentical: { dev: null, prod: mismatches.length === 0, mismatches },
  hydrationErrors: hydration(open),
  hydrationErrorsByEngine: { chromium: hydration(open), firefox: null, webkit: null },
  islandsWorkUnderCsp: page(prod, "/") && raw("chromium-prod.json").pages[0].interactions.searchResults.length > 0,
  islandsWorkWithoutCsp: open.pages[0].interactions.searchResults.length > 0,
  inlineScriptsOnIslandPage: inline.length,
  inlineStyleElementsOnIslandPage: ((html["/"] ?? "").match(/<style>/g) ?? []).length,
  cspViolations: [page(prod, "/"), page(prod, "/@demo")].flatMap(msgs).filter(csp).length,
  styleAttrViolations: msgs(page(prod, "/neg")).filter(styleAttr).length,
  styleAttrViolationsElsewhere: [page(prod, "/"), page(prod, "/@demo")].flatMap(msgs).filter(styleAttr).length,
  zeroJsRoute: {
    scriptTags: ((html["/@demo"] ?? "").match(/<script/g) ?? []).length,
    modulePreloads: ((html["/@demo"] ?? "").match(/rel="modulepreload"/g) ?? []).length,
    jsBytes: page(prod, "/@demo").scriptBytes,
  },
  jsGzipBytes: { reactRuntime, bootstrap, perIsland, total: reactRuntime + bootstrap + box + pick("Counter.") + pick("Search."), headroomFor75KB: 75 * 1024 - reactRuntime - bootstrap },
  astroFiles: 3,
  rawReports: readdirSync("measure/out/raw").map((f) => `raw/${f}`).sort(),
  buildSecondsMedian: seconds[1],
  deps: { direct: deps.direct.length, transitive: deps.transitive.length },
  verdict: "FAIL",
  failReasons: [
    "Island hydration needs inline <script> blocks (the astro-island runtime and the client:load directive) and an inline <style>; under the plan's no-inline, path-scoped CSP the islands never hydrate.",
    "Astro 7.3.5's own security.csp allows them only by hashing them (sent as a header or a <meta>), and step 5 counts a hash-only fix as FAIL.",
  ],
};
writeFileSync("measure/out/MEASUREMENTS.json", `${JSON.stringify(measurements, null, 2)}\n`);
console.log(JSON.stringify(measurements, null, 1));
