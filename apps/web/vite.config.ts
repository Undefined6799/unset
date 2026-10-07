// The two builds of apps/web (P1.23, P1.23c; ADR 0015), from this one config. The browser build: the bootstrap and
// the styles entry are the entries; each island becomes its own chunk through the bootstrap's lazy registry, and the
// manifest tells the server which file each one is and which CSS the styles entry emitted (vite 8.3.1:
// `build.manifest` writes dist/client/.vite/manifest.json). The server build (`vite build --ssr render.tsx`, so
// `isSsrBuild` is true; vite 8.3.1 `ConfigEnv`, dist/node/index.d.ts) bundles the render entry to dist/server so
// production runs no Vite and no TypeScript; it emits no assets, the browser build owns those. Both builds and Vitest
// name CSS Module classes with the one scopedName (scripts/ui/css-scope.ts), so a class the server renders is the
// selector in the browser's CSS. JSX goes through Vite's own oxc transform with the automatic runtime, so every island
// imports exactly `react/jsx-runtime`, the one npm module P1.23q's island-import-boundary rule allows;
// @vitejs/plugin-react is not used. A plain object per build in the shape of vite's UserConfig; Vite validates it.
import { scopedName } from "../../scripts/ui/css-scope.ts";

const shared = {
  oxc: { jsx: { runtime: "automatic", importSource: "react", development: false } },
  css: { modules: { generateScopedName: scopedName } },
};
// The styles entry imports each CSS Module as `<file>?styles-entry` (src/styles.ts). Vite's CSS plugin has already
// collected that module's CSS for the chunk; this empties its JS (the class-name map, which no page loads) and keeps
// the module so the CSS stays in the build (vite 8.3.1 vite:css-post returns `moduleSideEffects: false` for a CSS
// Module, dist/node/chunks/node.js:29755; rolldown 1.2.12 lets a later transform hook's `moduleSideEffects` win). A
// query is part of the module id, so an island importing the same file gets the ordinary module with its map.
const STYLES_ENTRY_ONLY = {
  name: "unset:styles-entry-css-only",
  enforce: "post",
  transform(_code: string, id: string) {
    if (!id.endsWith(".module.css?styles-entry")) return null;
    return { code: "", map: null, moduleSideEffects: "no-treeshake" };
  },
};
const browser = {
  ...shared,
  plugins: [STYLES_ENTRY_ONLY],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: {
      input: { boot: "src/islands/runtime/bootstrap.ts", styles: "src/styles.ts" },
      // An entry keeps its exports, and with them any CSS Module it exports (scripts/ui/web-css.test.ts builds one).
      preserveEntrySignatures: "exports-only",
    },
  },
};
const server = { ...shared, build: { outDir: "dist/server", emptyOutDir: true, ssrEmitAssets: false } };

export default ({ isSsrBuild }: { isSsrBuild?: boolean }) => (isSsrBuild ? server : browser);
