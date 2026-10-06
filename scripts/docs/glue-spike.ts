// P1.20 framework-glue spike: derives MEASUREMENTS.json from the raw reports the spike's measurement run wrote, and
// applies step 5's verdict rule (docs/ai/book/phase-1.md, "P1.20 — Framework-glue spike"). The spike writes its
// MEASUREMENTS.json with this module and glue-spike.test.ts recomputes it, so the two cannot drift.
// Budgets are plan §6.1's, read as KiB like every other §6.1 budget in the book (P1.21: "Limits are KiB").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FREE_DECLARATIVE_LINES } from "../budgets/count-glue-lines.ts";

export const ADR = "docs/human/decisions/0015-web-framework-glue.md";
export const EVIDENCE = "docs/human/evidence/0015-web-framework-glue";

const KIB = 1024;
const APP_PAGE_JS = 75 * KIB;
const ISLAND_JS = 15 * KIB;
const GLUE_PASS = 600;
const GLUE_BORDERLINE = 700;

/** Where each glue file's lines are reported; a file not listed fails the derivation. */
const GLUE_GROUP: Record<string, keyof Omit<GlueLines, "config" | "total">> = {
  "dev-ssr.ts": "devSsr",
  "manifest.ts": "manifest",
  "css.ts": "css",
  "styles.ts": "css",
  "islands.tsx": "islands",
  "boot.ts": "islands",
  "serialiser.ts": "serialiser",
  "document.tsx": "shell",
  "serve.ts": "shell",
};

export type Verdict = "PASS" | "BORDERLINE" | "FAIL";
type ClassMaps = Record<string, Record<string, string>>;
type GlueLines = {
  devSsr: number;
  manifest: number;
  css: number;
  islands: number;
  serialiser: number;
  shell: number;
  config: number;
  total: number;
};
type BrowserPage = {
  url: string;
  console: { type: string; text: string }[];
  pageErrors: string[];
  scriptBytes: number;
  hydrationErrors: number | null;
};
type BrowserReport = { engine: string; pages: BrowserPage[] };
type ManifestChunk = { file: string; imports?: string[] };

export type RawReports = {
  "fixture.json": { candidate: string; ssrRenderer: string };
  "glue.json": {
    files: Record<string, number>;
    configs: Record<string, { functionLines: number; declarativeLines: number }>;
  };
  "css-maps-prod-server.json": ClassMaps;
  "css-maps-prod-client.json": ClassMaps;
  "css-maps-dev-server.json": ClassMaps;
  "css-maps-dev-client.json": ClassMaps;
  "chromium-prod.json": BrowserReport;
  "chromium-dev.json": BrowserReport;
  "prod-html.json": Record<string, string>;
  "gzip.json": { level: number; bytes: Record<string, number> };
  "client-manifest.json": Record<string, ManifestChunk>;
  "build-stats.json": { cleanBuildSeconds: number[] };
  "deps.json": { versions: Record<string, string>; direct: string[]; transitive: string[] };
};

export type Measurements = {
  candidate: string;
  versions: Record<string, string>;
  ssrRenderer: string;
  glueLines: GlueLines;
  declarativeConfigLines: number;
  cssIdentical: { dev: boolean; prod: boolean; mismatches: string[] };
  hydrationErrors: number;
  hydrationErrorsByEngine: { chromium: number; firefox: number | null; webkit: number | null };
  cspViolations: number;
  styleAttrViolations: number;
  styleAttrViolationsElsewhere: number;
  zeroJsRoute: { scriptTags: number; modulePreloads: number; jsBytes: number };
  jsGzipBytes: {
    reactRuntime: number;
    bootstrap: number;
    perIsland: Record<string, number>;
    total: number;
    headroomFor75KB: number;
  };
  rawReports: string[];
  buildSecondsMedian: number;
  deps: { direct: number; transitive: number };
  verdict: Verdict;
};

export function readRawReports(dir: string, files: readonly string[]): RawReports {
  return Object.fromEntries(
    files.map((file) => [file.replace(/^raw\//, ""), JSON.parse(readFileSync(join(dir, file), "utf8"))]),
  ) as RawReports;
}

/** Every class that differs between two CSS Module class maps, or is missing on one side. */
export function cssMapMismatches(server: ClassMaps, client: ClassMaps): string[] {
  const mismatches: string[] = [];
  for (const file of [...new Set([...Object.keys(server), ...Object.keys(client)])].sort()) {
    const a = server[file];
    const b = client[file];
    if (a === undefined || b === undefined) {
      mismatches.push(`${file}: missing on one side`);
      continue;
    }
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (a[name] !== b[name]) mismatches.push(`${file} .${name}: ${a[name]} ≠ ${b[name]}`);
    }
  }
  return mismatches;
}

function glueLines(glue: RawReports["glue.json"]): GlueLines {
  const lines: GlueLines = { devSsr: 0, manifest: 0, css: 0, islands: 0, serialiser: 0, shell: 0, config: 0, total: 0 };
  for (const [file, count] of Object.entries(glue.files)) {
    const group = GLUE_GROUP[file];
    if (group === undefined) throw new Error(`glue file ${file} has no group`);
    lines[group] += count;
  }
  for (const { functionLines, declarativeLines } of Object.values(glue.configs)) {
    lines.config += functionLines + Math.max(0, declarativeLines - FREE_DECLARATIVE_LINES);
  }
  lines.total = Object.values(glue.files).reduce((a, b) => a + b, 0) + lines.config;
  return lines;
}

const pageAt = (report: BrowserReport, path: string): BrowserPage => {
  const page = report.pages.find((p) => new URL(p.url).pathname === path);
  if (page === undefined) throw new Error(`${report.engine} report has no ${path}`);
  return page;
};
const messages = (page: BrowserPage): string[] => [...page.console.map((m) => m.text), ...page.pageErrors];
const isCsp = (text: string): boolean => text.includes("Content Security Policy") || text.includes("Trusted Type");
const isStyleAttr = (text: string): boolean =>
  text.includes("Content Security Policy") && text.includes("inline style");

function hydrationErrors(report: BrowserReport): number {
  return report.pages.reduce(
    (sum, page) => sum + (page.hydrationErrors ?? 0) + messages(page).filter((t) => /hydrat/i.test(t)).length,
    0,
  );
}

/** Static-import closure of a manifest entry, as manifest keys. */
function closure(manifest: RawReports["client-manifest.json"], key: string, seen = new Set<string>()): Set<string> {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const next of manifest[key]?.imports ?? []) closure(manifest, next, seen);
  return seen;
}

function jsGzipBytes(raw: RawReports): Measurements["jsGzipBytes"] {
  const manifest = raw["client-manifest.json"];
  const gz = (keys: Iterable<string>) =>
    [...keys].reduce((sum, key) => {
      const bytes = raw["gzip.json"].bytes[(manifest[key]?.file ?? "").replace(/^assets\//, "")];
      if (bytes === undefined) throw new Error(`no gzip size for ${key}`);
      return sum + bytes;
    }, 0);
  const react = Object.keys(manifest).filter((key) => key.startsWith("_react-runtime"));
  const boot = closure(manifest, "src/glue/boot.ts");
  const reactRuntime = gz(react);
  const bootstrap = gz([...boot].filter((key) => !react.includes(key)));
  const islands = Object.keys(manifest).filter((key) => /^src\/islands\/\w+\.tsx$/.test(key));
  const perIsland = Object.fromEntries(
    islands.map((key) => [
      key.replace(/^src\/islands\/|\.tsx$/g, ""),
      gz([...closure(manifest, key)].filter((k) => !boot.has(k))),
    ]),
  );
  const page = new Set([...boot, ...islands.flatMap((key) => [...closure(manifest, key)])]);
  return {
    reactRuntime,
    bootstrap,
    perIsland,
    total: gz(page),
    headroomFor75KB: APP_PAGE_JS - reactRuntime - bootstrap,
  };
}

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** MEASUREMENTS.json from the raw reports alone; the verdict is step 5's rule applied to the result. */
export function deriveMeasurements(raw: RawReports): Measurements {
  const prod = raw["chromium-prod.json"];
  const dev = raw["chromium-dev.json"];
  const prodMismatches = cssMapMismatches(raw["css-maps-prod-server.json"], raw["css-maps-prod-client.json"]);
  const devMismatches = cssMapMismatches(raw["css-maps-dev-server.json"], raw["css-maps-dev-client.json"]);
  const appPages = [pageAt(prod, "/"), pageAt(prod, "/@demo")];
  const demoHtml = raw["prod-html.json"]["/@demo"] ?? "";
  const hydration = hydrationErrors(prod) + hydrationErrors(dev);
  const measured: Omit<Measurements, "verdict"> = {
    candidate: raw["fixture.json"].candidate,
    versions: raw["deps.json"].versions,
    ssrRenderer: raw["fixture.json"].ssrRenderer,
    glueLines: glueLines(raw["glue.json"]),
    declarativeConfigLines: Object.values(raw["glue.json"].configs).reduce((s, c) => s + c.declarativeLines, 0),
    cssIdentical: {
      dev: devMismatches.length === 0,
      prod: prodMismatches.length === 0,
      mismatches: [...prodMismatches.map((m) => `prod ${m}`), ...devMismatches.map((m) => `dev ${m}`)],
    },
    hydrationErrors: hydration,
    hydrationErrorsByEngine: { chromium: hydration, firefox: null, webkit: null },
    cspViolations: appPages.flatMap(messages).filter(isCsp).length,
    styleAttrViolations: messages(pageAt(prod, "/neg")).filter(isStyleAttr).length,
    styleAttrViolationsElsewhere: appPages.flatMap(messages).filter(isStyleAttr).length,
    zeroJsRoute: {
      scriptTags: (demoHtml.match(/<script/g) ?? []).length,
      modulePreloads: (demoHtml.match(/rel="modulepreload"/g) ?? []).length,
      jsBytes: pageAt(prod, "/@demo").scriptBytes,
    },
    jsGzipBytes: jsGzipBytes(raw),
    rawReports: Object.keys(raw)
      .map((file) => `raw/${file}`)
      .sort(),
    buildSecondsMedian: median(raw["build-stats.json"].cleanBuildSeconds),
    deps: { direct: raw["deps.json"].direct.length, transitive: raw["deps.json"].transitive.length },
  };
  return { ...measured, verdict: glueVerdict(measured) };
}

/** Step 5: PASS, BORDERLINE only for 600 < glue ≤ 700 with everything else holding, FAIL otherwise. */
export function glueVerdict(m: Omit<Measurements, "verdict">): Verdict {
  const zeroJs = m.zeroJsRoute.scriptTags === 0 && m.zeroJsRoute.modulePreloads === 0 && m.zeroJsRoute.jsBytes === 0;
  const budgets =
    m.jsGzipBytes.headroomFor75KB >= ISLAND_JS && Object.values(m.jsGzipBytes.perIsland).every((b) => b <= ISLAND_JS);
  const holds =
    m.cssIdentical.dev &&
    m.cssIdentical.prod &&
    m.hydrationErrors === 0 &&
    m.cspViolations === 0 &&
    m.styleAttrViolations >= 1 &&
    m.styleAttrViolationsElsewhere === 0 &&
    zeroJs &&
    budgets;
  if (!holds || m.glueLines.total > GLUE_BORDERLINE) return "FAIL";
  return m.glueLines.total <= GLUE_PASS ? "PASS" : "BORDERLINE";
}
