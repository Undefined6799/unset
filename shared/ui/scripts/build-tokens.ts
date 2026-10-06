// Turns the design sheet's tokens.json into tokens.css (P1.21; plan §8 Phase 1 styling, §11 Q11). One naming rule,
// Dark first (the sheet's native theme), every value validated: anything the generator does not understand stops the
// build with a code (TokenError) instead of being dropped or passed through.
//
// CSS read for the shapes emitted (MDN, current): @layer, @font-face descriptors `size-adjust`, `ascent-override`,
// `descent-override`, `line-gap-override` (CSS Fonts 5) and a "lo hi" `font-weight` range for variable fonts
// (CSS Fonts 4), `color-scheme`, and `prefers-color-scheme` (Media Queries 5).

export class TokenError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

/** One local fallback face whose metrics are adjusted to match a web font (shared/ui/tokens/font-metrics.json). */
export type FallbackFace = {
  suffix: string;
  local: string;
  sizeAdjust: string;
  ascentOverride: string;
  descentOverride: string;
  lineGapOverride: string;
};
export type FontMetrics = { sources: Record<string, string>; families: Record<string, FallbackFace[]> };

type Token = { name: string; value: unknown };
type Family = { tokens: Token[] };
type Font = { family: string; file: string; weight: string; style: string };
type Style = { name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string };
type TypeFamily = { fonts: Font[]; families: Record<string, string>; groups: { styles: Style[] }[] };
/** A custom property with one value per theme; `perTheme` when the sheet gave theme-keyed values. */
type Decl = { name: string; values: string[]; perTheme: boolean };

/** Families the generator knows, in emit order. Top-level `name` and `version` are sheet metadata. */
const FAMILIES = ["color", "type", "spacing", "radius", "shadow", "zIndex", "mark"] as const;
const METADATA = new Set(["name", "version"]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgb|rgba|hsl|oklch)\([\d.%\s,/-]+\)$/i;
const LENGTH = /^(?:0|\d*\.?\d+(?:px|rem|em|%))$/;
const SIGNED_LENGTH = /^(?:0|-?\d*\.?\d+(?:px|rem|em|%))$/;
const ALIAS = /^\{(.+)\}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function family(tokens: Record<string, unknown>, key: string): Family {
  const value = tokens[key];
  if (!isObject(value) || !Array.isArray(value.tokens))
    throw new TokenError("tokens.bad_shape", `${key}.tokens is not a list`);
  for (const token of value.tokens as unknown[]) {
    if (!isObject(token) || typeof token.name !== "string" || !NAME.test(token.name))
      throw new TokenError("tokens.bad_shape", `${key}: bad token ${JSON.stringify(token)}`);
  }
  return value as Family;
}

/** The theme ids, first "dark" and containing "light" (step 3). */
function themesOf(tokens: Record<string, unknown>): string[] {
  const color = tokens.color;
  const themes =
    isObject(color) && Array.isArray(color.themes) ? color.themes.map((t) => (isObject(t) ? t.id : t)) : [];
  if (themes[0] !== "dark" || !themes.includes("light"))
    throw new TokenError("tokens.bad_shape", "color.themes must start with dark and contain light");
  return themes as string[];
}

/** Step 3: every top-level key is known, and every token name is unique across families. */
function checkFamilies(tokens: Record<string, unknown>): void {
  for (const key of Object.keys(tokens)) {
    if (!METADATA.has(key) && !(FAMILIES as readonly string[]).includes(key))
      throw new TokenError("tokens.unknown_family", key);
  }
  const seen = new Set<string>();
  for (const key of FAMILIES.filter((k) => k !== "type")) {
    for (const { name } of family(tokens, key).tokens) {
      if (seen.has(name)) throw new TokenError("tokens.duplicate_name", name);
      seen.add(name);
    }
  }
}

/** Step 4: one value per theme; a theme-keyed object may name only themes, and a missing theme inherits the first. */
function perTheme(token: Token, themes: string[]): { values: unknown[]; perTheme: boolean } {
  if (!isObject(token.value)) return { values: themes.map(() => token.value), perTheme: false };
  const value = token.value;
  for (const key of Object.keys(value)) {
    if (!themes.includes(key)) throw new TokenError("tokens.bad_theme_key", `${token.name}: ${key}`);
  }
  const first = value[themes[0] ?? ""];
  if (first === undefined) throw new TokenError("tokens.bad_theme_key", `${token.name}: no ${themes[0]} value`);
  return { values: themes.map((t) => value[t] ?? first), perTheme: true };
}

function colorLiteral(name: string, value: unknown): string {
  if (typeof value === "string" && (HEX.test(value) || COLOR_FN.test(value))) return value;
  throw new TokenError("tokens.bad_color", `${name}: ${JSON.stringify(value)}`);
}

/** The literal a colour token has in one theme, following aliases; an unknown target or a cycle is bad_alias. */
function resolveColor(name: string, theme: number, raw: Map<string, unknown[]>, seen: string[] = []): string {
  const value = raw.get(name)?.[theme];
  const alias = typeof value === "string" ? ALIAS.exec(value)?.[1] : undefined;
  if (alias === undefined) return colorLiteral(name, value);
  if (!raw.has(alias) || seen.includes(alias)) throw new TokenError("tokens.bad_alias", `${name}: {${alias}}`);
  return resolveColor(alias, theme, raw, [...seen, name]);
}

/** Every colour token's literal per theme, aliases resolved (for the contrast check). */
export function resolveColors(tokens: Record<string, unknown>): { themes: string[]; colors: Map<string, string[]> } {
  const themes = themesOf(tokens);
  const raw = new Map(family(tokens, "color").tokens.map((t) => [t.name, perTheme(t, themes).values]));
  const colors = new Map([...raw.keys()].map((name) => [name, themes.map((_, i) => resolveColor(name, i, raw))]));
  return { themes, colors };
}

function colorDecls(tokens: Record<string, unknown>, themes: string[]): Decl[] {
  resolveColors(tokens);
  return family(tokens, "color").tokens.map((token) => {
    const { values, perTheme: themed } = perTheme(token, themes);
    const css = values.map((v) => {
      const alias = typeof v === "string" ? ALIAS.exec(v)?.[1] : undefined;
      return alias === undefined ? colorLiteral(token.name, v) : `var(--color-${alias})`;
    });
    return { name: `--color-${token.name}`, values: css, perTheme: themed };
  });
}

/** Splits on `sep` outside parentheses. */
function splitTop(text: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of text) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && sep.test(c)) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  return [...parts, current].map((p) => p.trim()).filter((p) => p !== "");
}

/** Step 5: `[inset] <len> <len> [<len> [<len>]] <colour>`, comma-separated. */
function shadow(name: string, value: unknown): string {
  const ok =
    typeof value === "string" &&
    splitTop(value, /,/).every((layer) => {
      const parts = splitTop(layer, /\s/);
      if (parts[0] === "inset") parts.shift();
      const color = parts.pop() ?? "";
      return (
        (HEX.test(color) || COLOR_FN.test(color)) &&
        parts.length >= 2 &&
        parts.length <= 4 &&
        parts.every((p) => SIGNED_LENGTH.test(p))
      );
    });
  if (!ok) throw new TokenError("tokens.bad_shadow", `${name}: ${JSON.stringify(value)}`);
  return value as string;
}

function scalar(name: string, value: unknown, valid: (v: string) => boolean): string {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !valid(text))
    throw new TokenError("tokens.bad_value", `${name}: ${JSON.stringify(value)}`);
  return text;
}

/** Steps 4 and 5 for every family but colour and type, under the one naming rule. */
function otherDecls(tokens: Record<string, unknown>, themes: string[]): Decl[] {
  const rules: Record<string, { prop: (n: string) => string; check: (n: string, v: unknown) => string }> = {
    spacing: { prop: (n) => `--${n}`, check: (n, v) => scalar(n, v, (s) => LENGTH.test(s)) },
    radius: {
      prop: (n) => (n.startsWith("radius-") ? `--${n}` : `--radius-${n}`),
      check: (n, v) => scalar(n, v, (s) => LENGTH.test(s)),
    },
    shadow: { prop: (n) => `--${n}`, check: shadow },
    zIndex: { prop: (n) => `--${n}`, check: (n, v) => scalar(n, v, (s) => /^-?\d+$/.test(s)) },
    mark: { prop: (n) => `--${n}`, check: (n, v) => scalar(n, v, (s) => /^\d*\.?\d+$/.test(s)) },
  };
  return Object.entries(rules).flatMap(([key, rule]) =>
    family(tokens, key).tokens.map((token) => {
      const { values, perTheme: themed } = perTheme(token, themes);
      return { name: rule.prop(token.name), values: values.map((v) => rule.check(token.name, v)), perTheme: themed };
    }),
  );
}

function typeOf(tokens: Record<string, unknown>): TypeFamily {
  const type = tokens.type;
  if (!isObject(type) || !Array.isArray(type.fonts) || !isObject(type.families) || !Array.isArray(type.groups))
    throw new TokenError("tokens.bad_shape", "type needs fonts, families and groups");
  return type as unknown as TypeFamily;
}

/** Step 6: font families with both fallback faces right after the real family, and four properties per style. */
function typeDecls(type: TypeFamily, metrics: FontMetrics, themes: string[]): Decl[] {
  const same = (name: string, value: string): Decl => ({ name, values: themes.map(() => value), perTheme: false });
  const families = Object.entries(type.families).map(([key, stack]) => {
    const [first, ...rest] = splitTop(stack, /,/);
    const real = first?.replace(/^"(.*)"$/, "$1") ?? "";
    const faces = metrics.families[real] ?? [];
    return same(`--font-${key}`, [first, ...faces.map((f) => `"${real} ${f.suffix}"`), ...rest].join(", "));
  });
  const styles = type.groups.flatMap((group) =>
    group.styles.flatMap((s) => [
      same(
        `--type-${s.name}-size`,
        scalar(s.name, s.fontSize, (v) => LENGTH.test(v)),
      ),
      same(
        `--type-${s.name}-line`,
        scalar(s.name, s.lineHeight, (v) => LENGTH.test(v)),
      ),
      same(
        `--type-${s.name}-weight`,
        scalar(s.name, s.fontWeight, (v) => /^[1-9]\d{0,2}$/.test(v)),
      ),
      same(
        `--type-${s.name}-tracking`,
        scalar(s.name, s.letterSpacing ?? "normal", (v) => v === "normal" || SIGNED_LENGTH.test(v)),
      ),
    ]),
  );
  return [...families, ...styles];
}

/**
 * Step 7: the real faces from the sheet, then the metric-adjusted local fallbacks font-metrics.json lists for the
 * family. A family with no entry gets none yet (the metrics arrive with their dev script, P1.21m); an entry with no
 * faces is an error.
 */
function fontFaces(type: TypeFamily, metrics: FontMetrics): string[] {
  return type.fonts.flatMap((font) => {
    const faces = metrics.families[font.family] ?? [];
    if (metrics.families[font.family] !== undefined && faces.length === 0)
      throw new TokenError("tokens.font_metrics", `no fallback faces for ${font.family}`);
    const file = font.file.split("/").pop() ?? "";
    const real = [
      `font-family: "${font.family}";`,
      `src: url("../fonts/${file}") format("woff2");`,
      `font-weight: ${scalar(font.family, font.weight, (v) => /^\d{3}( \d{3})?$/.test(v))};`,
      `font-style: ${font.style === "normal" ? "normal" : scalar(font.family, font.style, () => false)};`,
      "font-display: swap;",
    ];
    const fallbacks = faces.map((f) => [
      `font-family: "${font.family} ${f.suffix}";`,
      `src: local("${f.local}");`,
      `size-adjust: ${f.sizeAdjust};`,
      `ascent-override: ${f.ascentOverride};`,
      `descent-override: ${f.descentOverride};`,
      `line-gap-override: ${f.lineGapOverride};`,
    ]);
    return [real, ...fallbacks].map((lines) => rule("@font-face", lines, 1));
  });
}

/** The repository's Biome line width (biome.json formatter.lineWidth); tokens.css must already be formatted. */
const LINE_WIDTH = 120;

/** A declaration as Biome 2.5.15 formats it: on one line, or broken after the colon when wider than the limit. */
function declaration(pad: string, line: string): string {
  const colon = line.indexOf(": ");
  if (`${pad}${line}`.length <= LINE_WIDTH || colon === -1) return `${pad}${line}`;
  return `${pad}${line.slice(0, colon + 1)}\n${pad}  ${line.slice(colon + 2)}`;
}

function rule(selector: string, lines: string[], depth: number): string {
  const pad = "  ".repeat(depth);
  return [`${pad}${selector} {`, ...lines.map((l) => declaration(`${pad}  `, l)), `${pad}}`].join("\n");
}

/** Step 8: the tokens.css text and the set of custom property names it declares. */
export function buildTokens(
  tokens: Record<string, unknown>,
  metrics: FontMetrics,
): { css: string; names: Set<string> } {
  checkFamilies(tokens);
  const themes = themesOf(tokens);
  const type = typeOf(tokens);
  const decls = [...colorDecls(tokens, themes), ...typeDecls(type, metrics, themes), ...otherDecls(tokens, themes)];
  const light = themes.indexOf("light");
  const dark = ["color-scheme: dark;", ...decls.map((d) => `${d.name}: ${d.values[0]};`)];
  const lights = [
    "color-scheme: light;",
    ...decls.filter((d) => d.perTheme).map((d) => `${d.name}: ${d.values[light]};`),
  ];
  const css = [
    "@layer tokens {",
    ...fontFaces(type, metrics),
    rule(":root", dark, 1),
    rule(':root[data-theme="light"]', lights, 1),
    `  @media (prefers-color-scheme: light) {\n${rule(":root:not([data-theme])", lights, 2)}\n  }`,
    "}",
    "",
  ].join("\n");
  return { css, names: new Set(decls.map((d) => d.name)) };
}
