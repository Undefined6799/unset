import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildFontMetrics, type FaceMetrics, fallbackFace } from "./font-metrics.ts";

const UI = join(import.meta.dirname, "..", "ui");
const SPACE_GROTESK: FaceMetrics = { unitsPerEm: 1000, ascent: 984, descent: -292, lineGap: 0, xWidthAvg: 488 };
const ARIAL: FaceMetrics = { unitsPerEm: 2048, ascent: 1854, descent: -434, lineGap: 67, xWidthAvg: 913 };

test("fallback_face_same_metrics_is_identity", () => {
  expect(fallbackFace(ARIAL, { suffix: "Fallback", local: "Arial", metrics: ARIAL })).toEqual({
    suffix: "Fallback",
    local: "Arial",
    sizeAdjust: "100%",
    ascentOverride: "90.5273%",
    descentOverride: "21.1914%",
    lineGapOverride: "3.2715%",
  });
});

test("fallback_face_follows_capsize", () => {
  // size-adjust = (488 / 1000) / (913 / 2048); each metric / (1000 × size-adjust).
  const face = fallbackFace(SPACE_GROTESK, { suffix: "Fallback", local: "Arial", metrics: ARIAL });
  expect(face.sizeAdjust).toBe("109.4659%");
  expect(face.ascentOverride).toBe("89.891%");
  expect(face.descentOverride).toBe("26.675%");
  expect(face.lineGapOverride).toBe("0%");
});

test("font_metrics_family_without_fallback_rejected", () => {
  const font = { family: "Space Grotesk", path: "fonts/a.woff2", sha256: "0".repeat(64), metrics: SPACE_GROTESK };
  expect(() => buildFontMetrics([font], {})).toThrow(/no fallback fonts named for Space Grotesk/);
});

test("font_metrics_current", () => {
  // The metrics were computed from the fonts the sheet copy holds now; a changed font needs the generator re-run.
  const read = (path: string) => JSON.parse(readFileSync(join(UI, path), "utf8"));
  const fonts = read("sheet/source.json").files.filter((f: { path: string }) => f.path.endsWith(".woff2"));
  const metrics = read("tokens/font-metrics.json");
  expect(metrics.sources).toEqual(
    Object.fromEntries(fonts.map((f: { path: string; sha256: string }) => [f.path, f.sha256])),
  );
  expect(Object.keys(metrics.families).sort()).toEqual(["JetBrains Mono", "Space Grotesk"]);
});
