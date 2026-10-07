// Shared UI (MIT). P1.10: the island props serialiser (server) and reader (client).
// P1.25h: the kit components the app shell renders (P1.25). The build runners live in @unset/shared-ui-build, so
// this index may reach .tsx; Node never loads it.
export { Button, type ButtonProps } from "./components/Button/Button.tsx";
export { Callout, type CalloutProps } from "./components/Callout/Callout.tsx";
export { Footer, type FooterProps } from "./components/Footer/Footer.tsx";
export { Header, type HeaderProps } from "./components/Header/Header.tsx";
export { RadioGroup, type RadioGroupProps, type RadioOption } from "./components/RadioGroup/RadioGroup.tsx";
export { SkipLink, type SkipLinkProps } from "./components/SkipLink/SkipLink.tsx";
// P1.23: what an island file exports.
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
