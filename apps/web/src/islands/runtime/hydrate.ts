// Client side of the islands (P1.23; plan §5.1 and the book's bootstrap algorithm): hydrate each [data-island] from
// its JSON props. Any failure leaves that island as its server markup and never blocks another; nothing is reported
// anywhere but the console (plan §6: no real-user monitoring).
import { type IslandDefinition, type IslandProps, readProps } from "@unset/shared-ui";
import { createElement, type FunctionComponent } from "react";
import type { hydrateRoot } from "react-dom/client";

export type IslandLoaders = ReadonlyMap<string, () => Promise<IslandDefinition>>;

/** The browser console is the only place an island failure goes (the book's bootstrap algorithm, steps 1a to 1f). */
function report(code: string, ...details: unknown[]): void {
  // biome-ignore lint/suspicious/noConsole: P1.23's algorithm logs island failures to the console and nowhere else.
  console.error(code, ...details);
}

/** Hydrates one island; a rejection means it stays static. */
async function hydrateOne(element: HTMLElement, loaders: IslandLoaders, hydrate: typeof hydrateRoot): Promise<void> {
  const name = element.dataset.island ?? "";
  // readProps (P1.10) is the only JSON parser here; it throws PropsMissing for a missing or unreadable script.
  const props = readProps(element.dataset.islandId ?? "");
  const load = loaders.get(name);
  if (load === undefined) throw new Error("island.unknown");
  const island = await load();
  if (!island.propsSchema(props)) throw new Error("island.props_invalid");
  hydrate(element, createElement(island.component as FunctionComponent<IslandProps>, props as IslandProps), {
    onRecoverableError: (error) => report("island.recoverable", name, error),
  });
}

/** Hydrates every island under `root` side by side; resolves when each has hydrated or given up. */
export async function hydrateIslands(
  root: ParentNode,
  loaders: IslandLoaders,
  hydrate: typeof hydrateRoot,
): Promise<void> {
  const elements = [...root.querySelectorAll<HTMLElement>("[data-island]")];
  const results = await Promise.allSettled(elements.map((element) => hydrateOne(element, loaders, hydrate)));
  results.forEach((result, i) => {
    if (result.status === "rejected") report("island.static", elements[i]?.dataset.island, result.reason);
  });
}
