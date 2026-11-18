// The one theme file (P1.20c; ADR 0055 point 3; P2.24z). Its values are checked here as outcomes: every colour is a
// light and dark pair, text pairs meet WCAG 2.2 AA contrast (1.4.3, 4.5:1) and control edges the non-text bar
// (1.4.11, 3:1), in light and dark. The web app and the PDS screens both read this file, so nothing else holds a copy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const read = (path: string): string => readFileSync(join(import.meta.dirname, path), "utf8");
const theme = read("theme.css");

/** The custom properties declared directly in the first block opened by `selector` in `css`. */
function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m): [string, string] => [m[1] ?? "", m[2] ?? ""]));
}

const root = block(theme, ":root");
const colours = new Map(
  [...root].flatMap(([name, value]): [string, { light: string; dark: string }][] => {
    const m = /^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/.exec(value);
    return m ? [[name, { light: m[1] ?? "", dark: m[2] ?? "" }]] : [];
  }),
);
const scheme = { light: (name: string) => colours.get(name)?.light, dark: (name: string) => colours.get(name)?.dark };

/** WCAG 2.2 relative luminance and contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const TEXT: [string, string][] = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--muted-foreground", "--muted"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--card"],
  ["--destructive", "--background"],
  ["--destructive", "--card"],
  ["--info", "--background"],
  ["--info", "--card"],
];
const EDGES: [string, string][] = [
  ["--input", "--background"],
  ["--input", "--card"],
  ["--ring", "--background"],
];

describe("theme file", () => {
  test("every_colour_is_light_dark_of_two_literals", () => {
    const declared = [...root.keys()].filter((name) => !["--radius", "--font-sans", "--font-mono"].includes(name));
    expect([...colours.keys()]).toEqual(declared);
    expect(colours.size).toBeGreaterThan(0);
  });

  test.each(["light", "dark"] as const)("%s_text_and_edges_meet_wcag_aa", (name) => {
    const colour = (variable: string): string => scheme[name](variable) ?? "";
    for (const [fg, bg] of TEXT) expect(contrast(colour(fg), colour(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const [fg, bg] of EDGES) expect(contrast(colour(fg), colour(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  test("an_explicit_choice_sets_the_colour_scheme", () => {
    expect(root.get("color-scheme")).toBeUndefined();
    expect(theme).toMatch(/:root \{\n {2}color-scheme: light dark;/);
    expect(theme).toMatch(/:root\[data-theme="light"\] \{\n {2}color-scheme: light;\n\}/);
    expect(theme).toMatch(/:root\[data-theme="dark"\] \{\n {2}color-scheme: dark;\n\}/);
  });
});
