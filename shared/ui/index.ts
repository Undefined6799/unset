// Shared UI (MIT). P1.10: the island props serialiser (server) and reader (client).
export { type JsonValue, renderPropsTag, SerializeError, serializeProps } from "./islands/props.ts";
export type { FallbackFace, FontMetrics } from "./scripts/build-tokens.ts";
// P1.21m: the fallback-face metrics, computed by scripts/ui/font-metrics.ts.
export { buildFontMetrics, type FaceMetrics, type FallbackSpec, type WebFont } from "./scripts/font-metrics.ts";
// P1.21: the token build, run by scripts/ui/tokens.ts, which binds node:fs to it.
export { runTokens, type TokensIo } from "./scripts/tokens.ts";
export { PropsMissing, readProps } from "./src/islands/readProps.ts";
