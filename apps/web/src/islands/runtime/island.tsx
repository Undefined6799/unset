// Server side of an island (P1.23; plan §5.1): render it in place inside a marked container, followed by its props
// as P1.10's JSON script. The ids come from a per-render counter (i1, i2, …), never from data.
import {
  type IslandDefinition,
  type IslandProps,
  type IslandRenderer,
  SerializeError,
  serializeProps,
} from "@unset/shared-ui";
import { createContext, createElement, type FunctionComponent, type ReactNode, useContext } from "react";

class IslandError extends Error {
  constructor(message: string, island: string, options?: { cause?: unknown }) {
    super(`${message}: ${island}`, options);
    this.name = new.target.name;
  }
}
/** A programming error: no `*.island.tsx` has this name. */
export class IslandUnknown extends IslandError {
  constructor(island: string) {
    super("no island is named", island);
  }
}
/** A programming error: the props fail the island's schema or P1.10's serialiser rules. */
export class IslandPropsInvalid extends IslandError {
  constructor(island: string, options?: { cause?: unknown }) {
    super("island props are invalid", island, options);
  }
}
/** Outside production, props over the island's byte limit fail the render so the page is fixed before release. */
export class IslandPropsTooLarge extends IslandError {
  constructor(island: string, options?: { cause?: unknown }) {
    super("island props are over the limit", island, options);
  }
}

export type IslandEnv = "production" | "development" | "test";

/** One document render's islands: what hydrates, and what rendered static because its props were too large. */
export type IslandRun = {
  readonly registry: ReadonlyMap<string, IslandDefinition>;
  readonly env: IslandEnv;
  nextId: number;
  readonly used: Set<string>;
  readonly tooLarge: string[];
};

export const newIslandRun = (registry: IslandRun["registry"], env: IslandEnv): IslandRun => ({
  registry,
  env,
  nextId: 0,
  used: new Set(),
  tooLarge: [],
});

export const IslandRunContext = createContext<IslandRun | null>(null);

/** The props JSON, or null when production renders the island static because the props are over its limit. */
function propsJson(run: IslandRun, name: string, island: IslandDefinition, props: IslandProps) {
  try {
    // P1.10's serialiser with the island's own bound; the id beside it is the counter's `i<n>`, P1.10's id shape.
    return serializeProps(props, { maxBytes: island.maxPropsBytes });
  } catch (error) {
    if (!(error instanceof SerializeError)) throw error;
    if (error.code === "islands.props_invalid") throw new IslandPropsInvalid(name, { cause: error });
    if (run.env !== "production") throw new IslandPropsTooLarge(name, { cause: error });
    run.tooLarge.push(name);
    return null;
  }
}

export function Island({ name, props }: { name: string; props: IslandProps }): ReactNode {
  const run = useContext(IslandRunContext);
  if (run === null) throw new Error("an Island renders only inside the document");
  const island = run.registry.get(name);
  if (island === undefined) throw new IslandUnknown(name);
  if (!island.propsSchema(props)) throw new IslandPropsInvalid(name);
  run.nextId += 1;
  const id = `i${run.nextId}`;
  const json = propsJson(run, name, island, props);
  const content = createElement(island.component as FunctionComponent<IslandProps>, props);
  // Every island works without JS (§5.1), so one whose props cannot ship keeps its server markup and no marker.
  if (json === null) return <div>{content}</div>;
  run.used.add(name);
  return (
    <>
      <div data-island={name} data-island-id={id}>
        {content}
      </div>
      {/* React writes a string child of <script> as is (react-dom 19.2.8 pushScriptImpl); P1.10 escaped it. */}
      <script type="application/json" id={id}>
        {json}
      </script>
    </>
  );
}

/** A kit component's IslandSlot (P1.24j): the island it names must be the one the registry holds under that name. */
function SlotIsland({ name, island, props }: { name: string; island: IslandDefinition; props: IslandProps }) {
  const run = useContext(IslandRunContext);
  if (run !== null && run.registry.get(name) !== island) throw new IslandUnknown(name);
  return <Island name={name} props={props} />;
}

/** The renderer the document provides to IslandSlot, so every slot on the page hydrates. */
export const renderSlot: IslandRenderer = (name, island, props) => (
  <SlotIsland name={name} island={island} props={props} />
);
