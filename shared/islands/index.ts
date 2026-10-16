// The island runtime as its own workspace (P1.25i, docs/ai/book/phase-1.md).
// Copies of shared/ui's define, props, readProps and slot. safeHref stays in @unset/shared-ui.
// No other workspace imports this index in this step; P1.25p points the importers here.
export {
  defineIsland,
  ISLAND_MAX_PROPS_BYTES,
  type IslandDefinition,
  type IslandProps,
  type PropsSchema,
} from "./define.ts";
export { type JsonValue, renderPropsTag, SerializeError, serializeProps } from "./props.ts";
export { PropsMissing, readProps } from "./readProps.ts";
export {
  type IslandRenderer,
  IslandRendererContext,
  IslandSlot,
  type IslandSlotProps,
} from "./slot.ts";
