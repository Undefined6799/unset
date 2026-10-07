// Where a kit component places an island (P1.24j; architecture record 2026-10-07-p124j-island-slots-and-styles-
// budget.md, section 1). shared/ui cannot import apps/web's Island, so it declares this slot and apps/web provides the
// renderer by context. With no provider (the showcase, tests, a page with no islands) the slot renders the island's
// server markup statically, after the same propsSchema and P1.10 serialiser checks the hydrated path runs, so both
// paths refuse the same props. Props are JSON values only, so a ReactNode can never be passed; an island reaches
// sibling server markup only by an id from React's useId, never from data.
import { createContext, createElement, type FunctionComponent, type ReactNode, useContext } from "react";
import type { IslandDefinition, IslandProps } from "./define.ts";
import { SerializeError, serializeProps } from "./props.ts";

/** Renders an island in place; apps/web's document provides one that wraps it in a hydrating <Island>. */
export type IslandRenderer = (name: string, island: IslandDefinition, props: IslandProps) => ReactNode;

export const IslandRendererContext = createContext<IslandRenderer | null>(null);

export type IslandSlotProps<P extends IslandProps> = {
  /** The island's registry name: its `*.island.tsx` file stem. */
  name: string;
  /** The default export of that `*.island.tsx`. */
  island: IslandDefinition<P>;
  props: P;
};

/** Throws for props the hydrated path would refuse; props over the byte limit still render, as production does. */
function checkProps(island: IslandDefinition, props: IslandProps): void {
  if (!island.propsSchema(props)) throw new SerializeError("islands.props_invalid");
  try {
    serializeProps(props, { maxBytes: island.maxPropsBytes });
  } catch (error) {
    if (!(error instanceof SerializeError && error.code === "islands.props_too_large")) throw error;
  }
}

export function IslandSlot<P extends IslandProps>({ name, island, props }: IslandSlotProps<P>): ReactNode {
  const render = useContext(IslandRendererContext);
  if (render !== null) return render(name, island as IslandDefinition, props);
  checkProps(island as IslandDefinition, props);
  return createElement(island.component as FunctionComponent<P>, props);
}
