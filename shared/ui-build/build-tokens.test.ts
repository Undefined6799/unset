import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FontMetrics } from "@unset/shared-ui";
import { describe, expect, test } from "vitest";
import { buildTokens, TokenError } from "./build-tokens.ts";

const UI = join(import.meta.dirname, "..", "ui");
const sheet = (): Record<string, unknown> => JSON.parse(readFileSync(join(UI, "sheet", "tokens.json"), "utf8"));

const METRICS: FontMetrics = {
  sources: {},
  families: {
    "Space Grotesk": [
      {
        suffix: "Fallback",
        local: "Arial",
        sizeAdjust: "104%",
        ascentOverride: "90%",
        descentOverride: "26%",
        lineGapOverride: "0%",
      },
      {
        suffix: "Fallback Android",
        local: "Roboto",
        sizeAdjust: "102%",
        ascentOverride: "91%",
        descentOverride: "27%",
        lineGapOverride: "0%",
      },
    ],
    "JetBrains Mono": [
      {
        suffix: "Fallback",
        local: "Courier New",
        sizeAdjust: "99%",
        ascentOverride: "100%",
        descentOverride: "30%",
        lineGapOverride: "0%",
      },
      {
        suffix: "Fallback Android",
        local: "Droid Sans Mono",
        sizeAdjust: "98%",
        ascentOverride: "101%",
        descentOverride: "29%",
        lineGapOverride: "0%",
      },
    ],
  },
};

type Token = { name: string; value: unknown };
type Family = { tokens: Token[] };
/** The parts of the sheet the fixtures change. */
type Sheet = Record<string, unknown> & {
  color: Family & { themes: unknown[] };
  spacing: Family;
  shadow: Family;
  zIndex: Family;
  mark: Family;
};

/** The real sheet with one change applied to a copy. */
function sheetWith(change: (tokens: Sheet) => void): Record<string, unknown> {
  const tokens = sheet() as Sheet;
  change(tokens);
  return tokens;
}
const colors = (t: Sheet): Token[] => t.color.tokens;
/** The first token of a family, which every family on the sheet has. */
const first = (f: Family): Token => f.tokens[0] ?? { name: "", value: "" };
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof TokenError) return error.code;
    throw error;
  }
  return "no error";
};
/** The declarations of the block that starts with `selector`, as one string. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("buildTokens", () => {
  const { css, names } = buildTokens(sheet(), METRICS);

  test("tokens_naming_rule", () => {
    for (const name of [
      "--color-ground",
      "--space-4",
      "--radius-xs",
      "--radius-cut",
      "--shadow-1",
      "--z-modal",
      "--mark-gap",
      "--font-display",
      "--type-body-size",
      "--type-body-line",
      "--type-body-weight",
      "--type-label-tracking",
    ])
      expect(names, name).toContain(name);
    expect(css).toContain("--radius-cut: 10px;");
    expect(css.startsWith("@layer tokens {")).toBe(true);
  });

  test("tokens_alias_resolves", () => {
    expect(block(css, ":root")).toContain("--color-focus: var(--color-ink);");
  });

  test("tokens_theme_blocks", () => {
    const dark = block(css, ":root");
    expect(dark).toContain("color-scheme: dark;");
    expect(dark).toContain("--color-ground: #0a090c;");
    expect(dark).toContain("--space-4: 16px;");
    const light = block(css, ':root[data-theme="light"]');
    expect(light).toContain("color-scheme: light;");
    expect(light).toContain("--color-ground: #f0edee;");
    expect(light).not.toContain("--space-4");
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: light)"));
    const decls = (b: string): string[] =>
      b
        .split("\n")
        .slice(1)
        .map((l) => l.trim());
    expect(decls(block(media, ":root:not([data-theme])"))).toEqual(decls(light));
  });

  test("tokens_shadow_per_theme", () => {
    expect(block(css, ":root")).toContain("--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.6), 0 1px 3px rgba(0, 0, 0, 0.4);");
    expect(block(css, ':root[data-theme="light"]')).toContain("--shadow-1: 0 1px 2px rgba(10, 9, 12, 0.08)");
  });

  test("tokens_mark_string_parsed", () => {
    expect(block(css, ":root")).toContain("--mark-ring-diameter: 220;");
  });

  test("tokens_android_fallback_faces", () => {
    expect(css).toContain('font-family: "Space Grotesk Fallback";\n    src: local("Arial");');
    expect(css).toContain('font-family: "Space Grotesk Fallback Android";\n    src: local("Roboto");');
    expect(css).toContain('font-family: "JetBrains Mono Fallback Android";\n    src: local("Droid Sans Mono");');
    // Wider than Biome's 120 columns, so broken after the colon as Biome formats it.
    expect(block(css, ":root")).toContain(
      '--font-display:\n      "Space Grotesk", "Space Grotesk Fallback", "Space Grotesk Fallback Android", ui-sans-serif, system-ui, sans-serif;',
    );
    expect(css).toContain(
      'src: url("../fonts/SpaceGrotesk-Variable.woff2") format("woff2");\n    font-weight: 300 700;',
    );
  });

  test("tokens_output_is_stable", () => {
    expect(buildTokens(sheet(), METRICS).css).toBe(css);
  });
});

describe("buildTokens rejects", () => {
  test("tokens_bad_alias_rejected", () => {
    expect(
      codeOf(() =>
        buildTokens(
          sheetWith((t) => (first(t.color).value = "{nope}")),
          METRICS,
        ),
      ),
    ).toBe("tokens.bad_alias");
  });

  test("tokens_alias_cycle_rejected", () => {
    const cyclic = sheetWith((t) => {
      colors(t).push({ name: "a", value: "{b}" }, { name: "b", value: "{a}" });
    });
    expect(codeOf(() => buildTokens(cyclic, METRICS))).toBe("tokens.bad_alias");
  });

  test("tokens_named_color_rejected", () => {
    expect(
      codeOf(() =>
        buildTokens(
          sheetWith((t) => (first(t.color).value = "red")),
          METRICS,
        ),
      ),
    ).toBe("tokens.bad_color");
    expect(
      codeOf(() =>
        buildTokens(
          sheetWith((t) => (first(t.color).value = "var(--x)")),
          METRICS,
        ),
      ),
    ).toBe("tokens.bad_color");
  });

  test("tokens_duplicate_name_rejected", () => {
    const dup = sheetWith((t) => t.spacing.tokens.push({ name: "ground", value: "4px" }));
    expect(codeOf(() => buildTokens(dup, METRICS))).toBe("tokens.duplicate_name");
  });

  test("tokens_unknown_family_rejected", () => {
    const motion = sheetWith((t) => (t.motion = { tokens: [{ name: "fast", value: "100ms" }] }));
    expect(codeOf(() => buildTokens(motion, METRICS))).toBe("tokens.unknown_family");
  });

  test("tokens_bad_theme_key_rejected", () => {
    expect(
      codeOf(() =>
        buildTokens(
          sheetWith((t) => (first(t.color).value = { dark: "#000", dim: "#111" })),
          METRICS,
        ),
      ),
    ).toBe("tokens.bad_theme_key");
  });

  test("tokens_bad_shadow_rejected", () => {
    const bad = sheetWith((t) => (first(t.shadow).value = "0 1px red"));
    expect(codeOf(() => buildTokens(bad, METRICS))).toBe("tokens.bad_shadow");
    const blur = sheetWith((t) => (first(t.shadow).value = "0 1px 2px blur(3px)"));
    expect(codeOf(() => buildTokens(blur, METRICS))).toBe("tokens.bad_shadow");
  });

  test("tokens_bad_length_rejected", () => {
    expect(
      codeOf(() =>
        buildTokens(
          sheetWith((t) => (first(t.spacing).value = "4")),
          METRICS,
        ),
      ),
    ).toBe("tokens.bad_value");
    expect(
      codeOf(() =>
        buildTokens(
          sheetWith((t) => (first(t.zIndex).value = "1.5")),
          METRICS,
        ),
      ),
    ).toBe("tokens.bad_value");
    expect(
      codeOf(() =>
        buildTokens(
          sheetWith((t) => (first(t.mark).value = "big")),
          METRICS,
        ),
      ),
    ).toBe("tokens.bad_value");
  });

  test("tokens_themes_shape_rejected", () => {
    const lightFirst = sheetWith((t) => t.color.themes.reverse());
    expect(codeOf(() => buildTokens(lightFirst, METRICS))).toBe("tokens.bad_shape");
  });

  test("tokens_empty_fallback_entry_rejected", () => {
    expect(codeOf(() => buildTokens(sheet(), { sources: {}, families: { "Space Grotesk": [] } }))).toBe(
      "tokens.font_metrics",
    );
  });

  test("tokens_without_metrics_have_no_fallback_faces", () => {
    const { css } = buildTokens(sheet(), { sources: {}, families: {} });
    expect(css).not.toContain("Fallback");
    expect(css.match(/@font-face/g)).toHaveLength(2);
  });
});
