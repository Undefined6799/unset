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
  // The Button's cut and label type (shared/ui/sheet/components/Button/README.md).
  expect(pds.light.get("--unset-cut")).toBe(sheet.dark.get("--radius-cut"));
  for (const part of ["size", "line", "weight", "tracking"]) {
    expect(pds.light.get(`--unset-label-${part}`), part).toBe(sheet.dark.get(`--type-label-${part}`));
  }
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

// Codex on #1274: upstream's button utilities are layered, so these theme rules win only by being unlayered, and
// among themselves only by specificity. Every rule that restyles a button state names the themed variants, so a
// later state rule never loses to an earlier, more specific one.
const THEMED = '[data-slot="button"]:is(.bg-primary, .bg-secondary, .bg-background)';

test("pds_theme_button_state_rules_match_the_themed_specificity", () => {
  const selectors = [...theme.matchAll(/^\s*([^{}@/*\n][^{}\n]*?)\s*\{/gm)].map(([, s]) => s ?? "");
  // Split selector lists on commas outside parentheses, so `:is(a, b)` stays whole.
  const buttonRules = selectors
    .flatMap((s) => s.split(/,\s*(?![^()]*\))/))
    .filter((s) => s.includes('[data-slot="button"]'));
  for (const selector of buttonRules) expect(selector).toContain(THEMED);
  // Hover and active both exclude disabled buttons, so the later active rule beats hover on equal specificity.
  expect(theme).toContain(`${THEMED}:active:not(:disabled)::after {`);
});

test("pds_theme_button_focus_is_the_sheet_outline", () => {
  // shared/ui/sheet/components/Button/README.md: "a solid 2px `focus` outline, offset 2px"; the PDS ring token is
  // mapped to the sheet's focus colour (ink).
  const start = theme.indexOf(`${THEMED}:focus-visible {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = theme.slice(theme.indexOf("{", start) + 1, theme.indexOf("}", start));
  const focus = new Map(
    [...body.matchAll(/([a-z-]+):\s*([^;]+);/g)].map((m): [string, string] => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
  expect(focus.get("outline")).toBe("var(--unset-focus-width) solid var(--ring)");
  expect(focus.get("outline-offset")).toBe("var(--unset-focus-width)");
  expect(focus.get("box-shadow")).toBe("none");
  expect(block(theme, ":root").get("--unset-focus-width")).toBe("2px");
});

// Codex on #1274: the sheet's Button is 32px tall with space-2 above and below, space-4 either side and space-2
// between label and icon (shared/ui/sheet/components/Button/README.md, "Use"). Upstream sizes its text buttons with
// h-7, h-8 and h-9 and its icon buttons with size-*, so the themed text sizes take the sheet's box and icon buttons
// keep their squares.
test("pds_theme_text_buttons_take_the_sheet_size", () => {
  expect(pds.light.get("--unset-space-2")).toBe(sheet.dark.get("--space-2"));
  expect(pds.light.get("--unset-space-4")).toBe(sheet.dark.get("--space-4"));
  expect(pds.light.get("--unset-button-height")).toBe("32px");
  const selector = `${THEMED}:is(.h-7, .h-8, .h-9) {`;
  const start = theme.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = theme.slice(start + selector.length, theme.indexOf("}", start));
  const size = new Map(
    [...body.matchAll(/([a-z-]+):\s*([^;]+);/g)].map((m): [string, string] => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
  expect(Object.fromEntries(size)).toEqual({
    height: "auto",
    "min-height": "var(--unset-button-height)",
    padding: "var(--unset-space-2) var(--unset-space-4)",
    gap: "var(--unset-space-2)",
  });
});
