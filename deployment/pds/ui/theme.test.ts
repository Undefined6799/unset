import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// P2.24z: the PDS screens take their colours, radius and font names from the one theme, shared/ui/theme.css, which the
// recipe appends to upstream's stylesheet ahead of this file. These tests keep it that way: this file holds no colour,
// derives the radius scale exactly as the web app does, loads only the edge's fonts, and is appended after the theme
// and before the source is hashed. The theme's own values (contrast in light and dark) are tested beside it.
const root = join(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const pds = read("deployment/pds/ui/unset-theme.css");
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const withoutComments = strip(pds);

test("pds_file_holds_no_colour", () => {
  // Any literal colour would be a second copy of the theme: hex, a colour function or light-dark().
  expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(withoutComments).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/);
  // Every variable it reads is one the theme declares, so a rename in the theme cannot leave it reading nothing.
  const theme = read("shared/ui/theme.css");
  for (const [, name] of withoutComments.matchAll(/var\((--[a-z0-9-]+)\)/g)) expect(theme, name).toContain(`${name}:`);
});

test("pds_radius_scale_is_the_apps", () => {
  // The four steps, as apps/web/app.css derives them from the theme's --radius for the app's components.
  const steps = (css: string) =>
    [...css.matchAll(/^\s*(--radius-(?:sm|md|lg|xl)):\s*([^;]+);/gm)].map((m) => `${m[1]}: ${m[2]}`);
  expect(steps(withoutComments)).toHaveLength(4);
  expect(steps(withoutComments)).toEqual(steps(read("apps/web/app.css")));
});

// The page CSP allows fonts only from the edge's path (P2.24e), and nothing else may be fetched.
test("pds_theme_loads_only_edge_fonts", () => {
  const theme = strip(read("shared/ui/theme.css"));
  for (const css of [withoutComments, theme]) expect(css).not.toMatch(/@import/);
  expect(theme).not.toMatch(/url\(/);
  const urls = [...pds.matchAll(/url\(\s*["']?([^"')]+)/g)].map(([, url]) => url);
  expect(urls).toEqual(["/_unset/fonts/SpaceGrotesk-Variable.woff2", "/_unset/fonts/JetBrainsMono-Variable.woff2"]);
});

test("recipe_appends_the_theme_then_the_pds_file_before_the_source_is_hashed", () => {
  const recipe = read("deployment/pds/pds.Dockerfile");
  expect(recipe).toContain("COPY shared/ui/theme.css /theme.css");
  expect(recipe).toContain("COPY deployment/pds/ui/unset-theme.css /unset-theme.css");
  const append = recipe.indexOf("cat /theme.css /unset-theme.css >> packages/oauth/oauth-provider-ui/src/style.css");
  expect(append).toBeGreaterThan(0);
  expect(append).toBeLessThan(recipe.indexOf("find . -type f -exec sha256sum"));
});
