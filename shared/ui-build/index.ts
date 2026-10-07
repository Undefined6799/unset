// The UI build runners (MIT; P1.25h, architecture record 2026-10-07-p125-ui-build-workspace.md): pure functions the
// Node entries in scripts/ui/ run, binding node:fs to each. Every module this index reaches loads under plain Node,
// so nothing here is .tsx or imports react, and shared/ui is reached for types only (ui_build_is_jsx_free).
// P1.21m: the fallback-face metrics, computed by scripts/ui/font-metrics.ts.
export { buildFontMetrics, type FaceMetrics, type FallbackSpec, type WebFont } from "./font-metrics.ts";
// P1.24i: the icon build, run by scripts/ui/icons.ts.
export { type IconsIo, runIcons } from "./icons.ts";
// P1.21: the token build, run by scripts/ui/tokens.ts.
export { runTokens, type TokensIo } from "./tokens.ts";
