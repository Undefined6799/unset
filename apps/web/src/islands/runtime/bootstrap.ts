// The browser entry (P1.23): one external module, loaded only on pages with an island. A module script runs after
// the document is parsed, so every island's markup and props script are in place.
import type { IslandDefinition } from "@unset/shared-ui";
import { hydrateRoot } from "react-dom/client";
import { hydrateIslands } from "./hydrate.ts";
import { byName } from "./registry.ts";

// Lazy: each island is its own chunk, fetched only when the page has one (vite 8.3.1 import.meta.glob).
const loaders = byName(
  import.meta.glob<IslandDefinition>(["../*.island.tsx", "../../../../../shared/ui/islands/*.island.tsx"], {
    import: "default",
  }),
);

void hydrateIslands(document, loaders, hydrateRoot);
