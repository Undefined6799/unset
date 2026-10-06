// The render entry of apps/web (P1.23; ADG §1): the one module interfaces/http imports. The interface passes the
// request's preferences and the parsed build manifest as props; apps/web never reads files or config itself.
import type { IslandDefinition } from "@unset/shared-ui";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { type Assets, Document, type PagePrefs } from "./src/document.tsx";
import { type IslandEnv, newIslandRun } from "./src/islands/runtime/island.tsx";
import { byName } from "./src/islands/runtime/registry.ts";

export type { Assets, PagePrefs } from "./src/document.tsx";
export { Island, IslandPropsInvalid, IslandPropsTooLarge, IslandUnknown } from "./src/islands/runtime/island.tsx";
export type { BuildManifest } from "./src/islands/runtime/manifest.ts";
export { islandName } from "./src/islands/runtime/registry.ts";

/** Every island in the repository, found at build time. */
export const ISLANDS: ReadonlyMap<string, IslandDefinition> = byName(
  import.meta.glob<IslandDefinition>(["./src/islands/*.island.tsx", "../../shared/ui/islands/*.island.tsx"], {
    eager: true,
    import: "default",
  }),
);

export type PageInput = Readonly<{
  prefs: PagePrefs;
  assets: Assets;
  env: IslandEnv;
  title: string;
  body: ReactNode;
  /** The islands to look names up in; tests pass their own. */
  islands?: ReadonlyMap<string, IslandDefinition>;
}>;

/** The HTML of one page, and the islands production rendered static because their props were too large. */
export function renderPage(input: PageInput): { html: string; tooLarge: readonly string[] } {
  const run = newIslandRun(input.islands ?? ISLANDS, input.env);
  const body = renderToString(
    <Document prefs={input.prefs} title={input.title} assets={input.assets} run={run}>
      {input.body}
    </Document>,
  );
  return { html: `<!doctype html>${body}`, tooLarge: run.tooLarge };
}
