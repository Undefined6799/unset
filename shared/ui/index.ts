// Shared UI (MIT). P1.10: the island props serialiser (server) and reader (client).
// P1.23: what an island file exports.

// P2.05: the kit components the first screens use (P1.25 exports the rest with the app shell).
export { Button, type ButtonProps } from "./components/Button/Button.tsx";
export { Callout, type CalloutProps } from "./components/Callout/Callout.tsx";
export { Input, type InputProps } from "./components/Input/Input.tsx";
export { Link, type LinkProps } from "./components/Link/Link.tsx";
export {
  defineIsland,
  ISLAND_MAX_PROPS_BYTES,
  type IslandDefinition,
  type IslandProps,
  type PropsSchema,
} from "./islands/define.ts";
export { type JsonValue, renderPropsTag, SerializeError, serializeProps } from "./islands/props.ts";
// P1.24j: where a kit component places an island; apps/web provides the renderer.
export {
  type IslandRenderer,
  IslandRendererContext,
  IslandSlot,
  type IslandSlotProps,
} from "./islands/slot.ts";
// P1.24h: the one link validator; every component link takes its SafeHref.
export { type HrefScheme, type SafeHref, safeHref } from "./safe-href.ts";
export { PropsMissing, readProps } from "./src/islands/readProps.ts";
// P1.25h: the shape of tokens/font-metrics.json, which @unset/shared-ui-build produces.
export type { FallbackFace, FontMetrics } from "./tokens/font-metrics.ts";
