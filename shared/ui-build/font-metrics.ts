// Metric-adjusted local fallback faces (P1.21m; step book P1.21 step 7 and "font-metrics.json"): while a web font
// loads, the browser draws a local font scaled and spaced to take the same room, so the swap does not shift layout.
//
// The overrides follow Capsize's createFontStack (@capsizecss/core 4.1.3, dist/index.mjs calculateOverrideValues):
// size-adjust is the ratio of average character widths (latin subset), and each vertical metric is divided by the
// web font's em square scaled by it. Pure: the font files are read, and the fallback metrics looked up, by
// scripts/ui/font-metrics.ts.
import type { FallbackFace, FontMetrics } from "@unset/shared-ui";

/** Font-wide metrics in font units, as @capsizecss/unpack and @capsizecss/metrics report them. */
export type FaceMetrics = {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  xWidthAvg: number;
};

/** One local font to stand in for a web font: the face name suffix, the local() name and that font's metrics. */
export type FallbackSpec = { suffix: string; local: string; metrics: FaceMetrics };

/** A web font as the sheet copy holds it: family, file path (relative to shared/ui), its sha256 and metrics. */
export type WebFont = { family: string; path: string; sha256: string; metrics: FaceMetrics };

const percent = (value: number): string => `${Number((value * 100).toFixed(4))}%`;

export function fallbackFace(font: FaceMetrics, spec: FallbackSpec): FallbackFace {
  const fallback = spec.metrics;
  const sizeAdjust = font.xWidthAvg / font.unitsPerEm / (fallback.xWidthAvg / fallback.unitsPerEm);
  const em = font.unitsPerEm * sizeAdjust;
  return {
    suffix: spec.suffix,
    local: spec.local,
    sizeAdjust: percent(sizeAdjust),
    ascentOverride: percent(font.ascent / em),
    descentOverride: percent(Math.abs(font.descent) / em),
    lineGapOverride: percent(font.lineGap / em),
  };
}

/** font-metrics.json: the fallback faces per family, and the font hashes they were computed from. */
export function buildFontMetrics(fonts: WebFont[], fallbacks: Record<string, FallbackSpec[]>): FontMetrics {
  const families: Record<string, FallbackFace[]> = {};
  for (const font of fonts) {
    const specs = fallbacks[font.family];
    if (!specs || specs.length === 0) throw new Error(`font-metrics: no fallback fonts named for ${font.family}`);
    families[font.family] = specs.map((spec) => fallbackFace(font.metrics, spec));
  }
  return { sources: Object.fromEntries(fonts.map((f) => [f.path, f.sha256])), families };
}
