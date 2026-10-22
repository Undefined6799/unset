import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// P2.24x: the PDS theme repeats the design sheet's colours as literals, because it is bundled from upstream's
// source tree and cannot import shared/ui. This keeps every literal equal to its token in shared/ui/src/tokens.css.
const root = join(import.meta.dirname, "../../..");
const theme = readFileSync(join(import.meta.dirname, "unset-theme.css"), "utf8");
const tokens = readFileSync(join(root, "shared/ui/src/tokens.css"), "utf8");

// The custom properties declared directly in the first block opened by `selector`.
function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  return new Map(
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match): [string, string] => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

const sheet = {
  dark: block(tokens, ":root"),
  light: new Map([...block(tokens, ":root"), ...block(tokens, ':root[data-theme="light"]')]),
};
const pds = {
  light: block(theme, ":root"),
  dark: block(theme.slice(theme.indexOf("@media (prefers-color-scheme: dark)")), ":root"),
};

// Each upstream shadcn token and the sheet token it takes.
const MAPPING: Record<string, string> = {
  "--background": "--color-ground",
  "--foreground": "--color-ink",
  "--card": "--color-surface-card",
  "--card-foreground": "--color-ink",
  "--popover": "--color-surface-raised",
  "--popover-foreground": "--color-ink",
  "--secondary": "--color-surface-raised",
  "--secondary-foreground": "--color-ink",
  "--muted": "--color-surface-sunken",
  "--muted-foreground": "--color-ink-muted",
  "--accent": "--color-surface-raised",
  "--accent-foreground": "--color-ink",
  "--border": "--color-line",
  "--input": "--color-line-strong",
  "--primary": "--color-ink",
  "--primary-foreground": "--color-on-ink",
  "--destructive": "--color-plum",
  "--ring": "--color-ink",
  "--info": "--color-cyan",
  "--success": "--color-emerald",
  "--sidebar": "--color-surface-sunken",
  "--sidebar-foreground": "--color-ink",
  "--sidebar-accent": "--color-surface-raised",
  "--sidebar-accent-foreground": "--color-ink",
  "--sidebar-border": "--color-line",
  "--unset-shadow-hard": "--color-shadow-hard",
};

// A sheet value may point at another token (`var(--color-line-strong)`); follow it to the literal.
function resolve(scheme: Map<string, string>, name: string): string | undefined {
  const value = scheme.get(name);
  const ref = value && /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
  return ref ? resolve(scheme, ref) : value;
}

test.each(["light", "dark"] as const)("pds_%s_colours_equal_the_design_sheet", (scheme) => {
  for (const [name, token] of Object.entries(MAPPING)) {
    const expected = resolve(sheet[scheme], token);
    expect(expected, `${token} in tokens.css`).toMatch(/^#[0-9a-f]{6}$/);
    expect(pds[scheme].get(name), `${scheme} ${name}`).toBe(expected);
  }
});

test("pds_theme_radius_and_fonts_follow_the_sheet", () => {
  expect(pds.light.get("--radius")).toBe(sheet.dark.get("--radius-sm"));
  // Cards: half the radius, the sheet's radius-xs.
  expect(theme).toContain("border-radius: calc(var(--radius) / 2);");
  expect(`${Number.parseInt(pds.light.get("--radius") ?? "", 10) / 2}px`).toBe(sheet.dark.get("--radius-xs"));
  expect(pds.light.get("--font-sans")?.startsWith('"Space Grotesk"')).toBe(true);
  expect(pds.light.get("--font-mono")?.startsWith('"JetBrains Mono"')).toBe(true);
});

// The page CSP allows fonts only from the edge's path (P2.24e), and nothing else may be fetched.
test("pds_theme_loads_only_edge_fonts", () => {
  const urls = [...theme.matchAll(/url\(\s*["']?([^"')]+)/g)].map(([, url]) => url);
  expect(urls).toEqual(["/_unset/fonts/SpaceGrotesk-Variable.woff2", "/_unset/fonts/JetBrainsMono-Variable.woff2"]);
  for (const url of urls) expect(url).toMatch(/^\/_unset\/fonts\/[A-Za-z0-9-]+\.woff2$/);
  expect(theme).not.toMatch(/@import/);
});

test("recipe_appends_the_theme_before_the_source_is_hashed", () => {
  const recipe = readFileSync(join(import.meta.dirname, "../Dockerfile"), "utf8");
  expect(recipe).toContain("COPY ui/unset-theme.css /unset-theme.css");
  const append = recipe.indexOf("cat /unset-theme.css >> packages/oauth/oauth-provider-ui/src/style.css");
  expect(append).toBeGreaterThan(0);
  expect(append).toBeLessThan(recipe.indexOf("find . -type f -exec sha256sum"));
});
