// The browser build of apps/web (P1.23; ADR 0015). Only the bootstrap is an entry; each island becomes its own chunk
// through the bootstrap's lazy registry, and the manifest tells the server which file each one is (vite 8.3.1:
// `build.manifest` writes dist/client/.vite/manifest.json). JSX goes through Vite's own oxc transform with the
// automatic runtime, so every island imports exactly `react/jsx-runtime`, the one npm module P1.23q's
// island-import-boundary rule allows; @vitejs/plugin-react is not used. A plain object in the shape of vite's
// UserConfig (dist/node/index.d.ts): apps/web imports no build tool, and Vite validates it when it loads.
export default {
  oxc: { jsx: { runtime: "automatic", importSource: "react", development: false } },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: { input: { boot: "src/islands/runtime/bootstrap.ts" } },
  },
};
