// Shared UI (MIT). P1.10: the island props serialiser (server) and reader (client).
// P1.23: what an island file exports.
export {
  defineIsland,
  ISLAND_MAX_PROPS_BYTES,
  type IslandDefinition,
  type IslandProps,
  type PropsSchema,
} from "./islands/define.ts";
export { type JsonValue, renderPropsTag, SerializeError, serializeProps } from "./islands/props.ts";
export type { FallbackFace, FontMetrics } from "./scripts/build-tokens.ts";
// P1.21m: the fallback-face metrics, computed by scripts/ui/font-metrics.ts.
export { buildFontMetrics, type FaceMetrics, type FallbackSpec, type WebFont } from "./scripts/font-metrics.ts";
// P1.24i: the icon build, run by scripts/ui/icons.ts, which binds node:fs to it.
export { type IconsIo, runIcons } from "./scripts/icons.ts";
// P1.21: the token build, run by scripts/ui/tokens.ts, which binds node:fs to it.
export { runTokens, type TokensIo } from "./scripts/tokens.ts";
export { PropsMissing, readProps } from "./src/islands/readProps.ts";
