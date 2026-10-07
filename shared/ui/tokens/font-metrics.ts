// The shape of tokens/font-metrics.json (P1.21m): shared/ui owns it, and shared/ui-build produces it (P1.25h;
// architecture record 2026-10-07-p125-ui-build-workspace.md, amendment 13:10Z).
/** One local fallback face whose metrics are adjusted to match a web font. */
export type FallbackFace = {
  suffix: string;
  local: string;
  sizeAdjust: string;
  ascentOverride: string;
  descentOverride: string;
  lineGapOverride: string;
};
export type FontMetrics = { sources: Record<string, string>; families: Record<string, FallbackFace[]> };
