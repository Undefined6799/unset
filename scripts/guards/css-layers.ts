// Guard (P1.21l; architecture ruling 2026-10-06, point 2): every CSS file sits in its planned place and keeps its
// rules inside that place's cascade layer, and every var(--x) it uses is a token or declared in the same file.
// Biome's nursery useLayeredStyles checks that rules are layered at all; only a path-aware scan can check which layer,
// so this guard stays as the backstop (point 7). Layer names come from the one statement in shared/ui/src/layers.css.
//
// CSS facts relied on (CSS Cascade 5, w3.org/TR/css-cascade-5, "@layer"): the statement form `@layer a, b;` fixes
// the order, and a style outside every layer outranks all layered styles, so one stray rule beats the whole system.
import { type Finding, filesUnder, read, scanFiles } from "./files.ts";

export const SCANNED_DIRS = ["apps", "interfaces", "domains", "infrastructure", "shared"] as const;
const RULE = "css-layers";
export const LAYERS_FILE = "shared/ui/src/layers.css";
const TOKENS_FILE = "shared/ui/src/tokens.css";
const DECLARATION = "declaration";

/** The layer a file's rules must sit in; DECLARATION for layers.css; undefined where no CSS is planned. */
export function layerFor(file: string): string | undefined {
  if (file === LAYERS_FILE) return DECLARATION;
  if (file === TOKENS_FILE) return "tokens";
  if (file === "shared/ui/src/base.css") return "base";
  if (/^shared\/ui\/components\/.+\.module\.css$/.test(file)) return "components";
  if (/^apps\/[^/]+\/(?:src\/)?screens\/.+\.module\.css$/.test(file)) return "screens";
  return undefined;
}

/** Comments become spaces (newlines kept, so line numbers hold); an unclosed comment runs to the end. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (c) => c.replace(/[^\n]/g, " "));
}

type TopLevel = { prelude: string; line: number; block: boolean };

/** The top-level statements and blocks of a stylesheet; strings are skipped so a "{" inside one does not count. */
function topLevel(css: string): TopLevel[] | "unbalanced" {
  const items: TopLevel[] = [];
  let depth = 0;
  let line = 1;
  let start = 0;
  let quote = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\n") line++;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || (ch === ";" && depth === 0)) {
      if (depth === 0) items.push(itemAt(css, start, i, line, ch === "{"));
      if (ch === "{") depth++;
      else start = i + 1;
    } else if (ch === "}") {
      if (--depth < 0) return "unbalanced";
      if (depth === 0) start = i + 1;
    }
  }
  return depth === 0 && quote === "" && css.slice(start).trim() === "" ? items : "unbalanced";
}

/** One top-level item: its prelude text, collapsed, and the line it starts on. */
function itemAt(css: string, start: number, end: number, endLine: number, block: boolean): TopLevel {
  const raw = css.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const line = endLine - (raw.slice(lead).match(/\n/g)?.length ?? 0);
  return { prelude: raw.trim().replace(/\s+/g, " "), line, block };
}

/** The names in layers.css's one `@layer a, b, c;` statement, or undefined when the file is not just that. */
export function declaredLayers(source: string): string[] | undefined {
  const items = topLevel(stripComments(source));
  if (items === "unbalanced" || items.length !== 1 || items[0]?.block) return undefined;
  const m = /^@layer ((?:[A-Za-z][\w-]*)(?:, ?[A-Za-z][\w-]*)*)$/.exec(items[0]?.prelude ?? "");
  return m?.[1]?.split(/, ?/);
}

/** Custom properties a stylesheet declares (`--x:`). */
const declaredVars = (css: string): Set<string> =>
  new Set([...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1] ?? ""));

type Context = { layers: string[] | undefined; tokens: Set<string> };

function layerFindings(file: string, css: string, ctx: Context): Finding[] {
  const finding = (line: number, text: string): Finding => ({ file, line, rule: RULE, text });
  const layer = layerFor(file);
  if (layer === undefined) return [finding(1, "CSS outside the planned places (tokens, base, components, screens)")];
  if (layer === DECLARATION) {
    return ctx.layers ? [] : [finding(1, "layers.css must hold exactly one `@layer a, b, …;` statement")];
  }
  if (!ctx.layers?.includes(layer)) return [finding(1, `layer ${layer} is not declared in ${LAYERS_FILE}`)];
  const items = topLevel(css);
  if (items === "unbalanced") return [finding(1, "unbalanced braces, comment or string")];
  return items
    .filter((item) => !(item.block && item.prelude === `@layer ${layer}`))
    .map((item) => finding(item.line, `outside @layer ${layer}: ${item.prelude.slice(0, 60)}`));
}

function varFindings(file: string, css: string, ctx: Context): Finding[] {
  const own = declaredVars(css);
  const findings: Finding[] = [];
  css.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      const name = m[1] ?? "";
      if (!ctx.tokens.has(name) && !own.has(name)) {
        findings.push({ file, line: i + 1, rule: RULE, text: `${name} is not a token or declared in this file` });
      }
    }
  });
  return findings;
}

export function scanCss(file: string, source: string, ctx: Context): Finding[] {
  const css = stripComments(source);
  return [...layerFindings(file, css, ctx), ...varFindings(file, css, ctx)];
}

/** Every .css file the guard reads; a test checks it is more than none (AB-4). */
export const scannedFiles = (root: string): string[] => filesUnder(root, SCANNED_DIRS, /\.css$/);

export function scanAll(root: string): Finding[] {
  const files = scannedFiles(root);
  if (files.length === 0) return [];
  const source = (file: string): string => {
    try {
      return stripComments(read(root, file));
    } catch {
      return "";
    }
  };
  const ctx: Context = {
    layers: files.includes(LAYERS_FILE) ? declaredLayers(source(LAYERS_FILE)) : undefined,
    tokens: declaredVars(source(TOKENS_FILE)),
  };
  return scanFiles(root, files, RULE, (file, text) => scanCss(file, text, ctx));
}
