import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { TokenError } from "./build-tokens.ts";
import { type ContrastPair, checkContrast, contrastRatio } from "./contrast.ts";

const UI = join(import.meta.dirname, "..");
const read = (path: string) => JSON.parse(readFileSync(join(UI, path), "utf8"));
const PAIRS: ContrastPair[] = read("tokens/contrast-pairs.json").pairs;

describe("contrast", () => {
  test("contrast_ratio_matches_wcag", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    // A translucent colour is composited over the colour beneath before measuring.
    expect(contrastRatio("#ffffff", "rgba(0, 0, 0, 0.5)", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#808080"),
      1,
    );
  });

  test("tokens_contrast_sheet_passes", () => {
    const results = checkContrast(read("sheet/tokens.json"), PAIRS);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results).toHaveLength(PAIRS.length * 2);
  });

  test("tokens_contrast_fails_low", () => {
    const tokens = read("sheet/tokens.json");
    const muted = tokens.color.tokens.find((t: { name: string }) => t.name === "ink-muted");
    muted.value.dark = "#6b686c"; // about 3.4:1 on ground
    const pair: ContrastPair = { fg: "ink-muted", bg: "ground", min: 4.5 };
    const [dark] = checkContrast(tokens, [pair]);
    expect(dark).toMatchObject({ theme: "dark", ok: false });
    expect(() => checkContrast(tokens, [pair], { throwOnFail: true })).toThrow(TokenError);
    expect(() => checkContrast(tokens, [pair], { throwOnFail: true })).toThrow(
      /^tokens\.contrast: ink-muted\/ground\/dark\/3\.\d\d$/,
    );
  });

  test("tokens_contrast_ascii_field_pairs_present", () => {
    const overs = new Set(PAIRS.filter((p) => p.bg === "surface-card" && p.over !== undefined).map((p) => p.over));
    expect([...overs].sort()).toEqual(["cyan", "emerald", "line", "line-strong", "plum"]);
  });

  test("contrast_unknown_token_rejected", () => {
    expect(() => checkContrast(read("sheet/tokens.json"), [{ fg: "nope", bg: "ground", min: 3 }])).toThrow(
      "tokens.contrast_pair",
    );
  });
});
