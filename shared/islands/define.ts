// What an island file exports (P1.23; plan §5.1). An island is a component plus a check of its props; both run on
// the server before render and in the browser before hydration, so props that do not match never reach the
// component. It lives in shared/ui because a `*.island.tsx` may import nothing else (P1.23q's island-import-boundary).
import type { JsonValue } from "./props.ts";

/** Props are a plain object of JSON values; user-keyed data travels as `[key, value]` pairs (P1.10's key rule). */
export type IslandProps = { [key: string]: JsonValue };
/** A check of untrusted props: a type guard, so a passing value is typed for the component. */
export type PropsSchema<P extends IslandProps> = (value: unknown) => value is P;

/**
 * An island as the registry holds it. defineIsland checks that the component and the schema agree on P; the registry
 * only ever calls the component with props the schema passed. P stays on the definition so IslandSlot can type the
 * props a kit component passes (P1.24j); `component` is a method, so a typed island is still an IslandDefinition.
 */
export type IslandDefinition<P extends IslandProps = IslandProps> = Readonly<{
  /** A React function component. Typed loosely so this module does not depend on React. */
  component(props: P): unknown;
  propsSchema: (value: unknown) => boolean;
  maxPropsBytes: number;
}>;

/** P1.10's serializeProps bound: an island's props may be at most this many bytes, never more. */
export const ISLAND_MAX_PROPS_BYTES = 15_360;

export function defineIsland<P extends IslandProps>(
  component: (props: P) => unknown,
  opts: { propsSchema: PropsSchema<P>; maxPropsBytes?: number },
): IslandDefinition<P> {
  const max = opts.maxPropsBytes ?? ISLAND_MAX_PROPS_BYTES;
  if (!(Number.isInteger(max) && max > 0 && max <= ISLAND_MAX_PROPS_BYTES)) {
    throw new RangeError(`maxPropsBytes must be an integer from 1 to ${ISLAND_MAX_PROPS_BYTES}`);
  }
  return Object.freeze({ component, propsSchema: opts.propsSchema, maxPropsBytes: max });
}
