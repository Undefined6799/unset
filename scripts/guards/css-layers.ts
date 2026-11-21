// Guard (P1.21l; architecture ruling 2026-10-06, point 2): every CSS file sits in its planned place and keeps its
// rules inside that place's cascade layer, and every var(--x) it uses is a token or declared in the same file.
// Biome's nursery useLayeredStyles checks that rules are layered at all; only a path-aware scan can check which layer,
// so this guard stays as the backstop (point 7). Layer names come from the one statement in shared/ui/src/layers.css.
//
// CSS facts relied on (CSS Cascade 5, w3.org/TR/css-cascade-5, "@layer"): the statement form `@layer a, b;` fixes
// the order, and a style outside every layer outranks all layered styles, so one stray rule beats the whole system.
import { type Finding, filesUnder, read, scanFiles } from "./files.ts";

const SCANNED_DIRS = ["apps", "interfaces", "domains", "infrastructure", "shared"] as const;
const RULE = "css-layers";
export const LAYERS_FILE = "shared/ui/src/layers.css";
const TOKENS_FILE = "shared/ui/src/tokens.css";
const DECLARATION = "declaration";
/** ADR 0055: the Svelte UI's one theme file and its Tailwind entries, the web's and the chat page's (ADR 0099).
 * Tailwind, not layers.css, orders their layers. */
export const THEME_FILE = "shared/ui/theme.css";
export const TAILWIND_FILE = "apps/web/app.css";
const TAILWIND_FILES: ReadonlySet<string> = new Set([TAILWIND_FILE, "apps/chat/app.css"]);
const THEME = "theme-file";
const TAILWIND = "tailwind-entry";
/** The only blocks the theme file may hold: the variables, and the two explicit colour-scheme choices. */
const THEME_BLOCKS: readonly string[] = [":root", ':root[data-theme="light"]', ':root[data-theme="dark"]'];

/** The layer a file's rules must sit in; DECLARATION for layers.css; undefined where no CSS is planned. */
export function layerFor(file: string): string | undefined {
  if (file === LAYERS_FILE) return DECLARATION;
  if (file === TOKENS_FILE) return "tokens";
  if (file === THEME_FILE) return THEME;
  if (TAILWIND_FILES.has(file)) return TAILWIND;
  if (file === "shared/ui/src/base.css") return "base";
  if (/^shared\/ui\/components\/.+\.module\.css$/.test(file)) return "components";
  if (/^apps\/[^/]+\/(?:src\/)?screens\/.+\.module\.css$/.test(file)) return "screens";
  // The owner's README editor styles a page of its own (ADR 0037 point 5).
  if (/^apps\/web\/src\/editor\/.+\.module\.css$/.test(file)) return "screens";
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

type Context = { layers: string[] | undefined; tokens: Set<string>; themeVars: Set<string> };

/**
 * The theme file stays plain and unlayered so the PDS screens can append it (ADR 0055 point 3): only the three
 * :root blocks, holding only custom properties and color-scheme, with no @import and no url().
 */
function themeFindings(file: string, css: string): Finding[] {
  const finding = (line: number, text: string): Finding => ({ file, line, rule: RULE, text });
  const items = topLevel(css);
  if (items === "unbalanced") return [finding(1, "unbalanced braces, comment or string")];
  const out = items
    .filter((item) => !(item.block && THEME_BLOCKS.includes(item.prelude)))
    .map((item) => finding(item.line, `theme file holds only its :root blocks: ${item.prelude.slice(0, 60)}`));
  css.split("\n").forEach((text, i) => {
    const declaration = /^\s*([A-Za-z-]+)\s*:/.exec(text)?.[1];
    if (declaration !== undefined && !declaration.startsWith("--") && declaration !== "color-scheme")
      out.push(finding(i + 1, `theme file declares only variables and color-scheme: ${declaration}`));
    if (/@import|url\(/.test(text)) out.push(finding(i + 1, "theme file loads nothing: no @import or url()"));
  });
  return out;
}

function layerFindings(file: string, css: string, ctx: Context): Finding[] {
  const finding = (line: number, text: string): Finding => ({ file, line, rule: RULE, text });
  const layer = layerFor(file);
  if (layer === THEME) return themeFindings(file, css);
  if (layer === TAILWIND) return [];
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
  // The Tailwind entry reads the theme file's variables, not the React UI's tokens.
  const known = TAILWIND_FILES.has(file) ? ctx.themeVars : ctx.tokens;
  const own = declaredVars(css);
  const findings: Finding[] = [];
  css.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      const name = m[1] ?? "";
      if (!known.has(name) && !own.has(name)) {
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
    themeVars: declaredVars(source(THEME_FILE)),
  };
  return scanFiles(root, files, RULE, (file, text) => scanCss(file, text, ctx));
}
