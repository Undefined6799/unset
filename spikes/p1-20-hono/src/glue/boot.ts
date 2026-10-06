// Client bootstrap, one external module: hydrate each [data-island] from its JSON props. No inline script.
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { readProps } from "./serialiser.ts";

declare const SPIKE_INSTRUMENT: boolean;
const counter = globalThis as { __hydrationErrors?: number };
counter.__hydrationErrors = 0;

for (const element of document.querySelectorAll<HTMLElement>("[data-island]")) {
  const props = readProps(element.dataset.props ?? "") as Record<string, unknown>;
  const module = (await import(/* @vite-ignore */ element.dataset.island ?? "")) as { default: () => unknown };
  hydrateRoot(element, createElement(module.default as never, props), {
    onRecoverableError: (error) => {
      if (SPIKE_INSTRUMENT) counter.__hydrationErrors = (counter.__hydrationErrors ?? 0) + 1;
      console.error(error);
    },
  });
}
