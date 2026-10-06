import { createHash } from "node:crypto";
import { relative } from "node:path";
import devServer, { defaultOptions } from "@hono/vite-dev-server";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = new URL("../..", import.meta.url).pathname;
// The dev server skips every /@ path by default (dev-server.mjs:15, 0.26.1), which hides profile URLs like /@handle;
// keep only Vite's own /@ prefixes out of the app. .js paths stay excluded, so the dev preamble has no extension.
const VITE_PREFIXES = /^\/@(vite|react-refresh|id|fs)(\/|$)/;
const exclude = [...defaultOptions.exclude.filter((re) => String(re) !== String(/^\/@.+$/)), VITE_PREFIXES];

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), devServer({ entry: "src/glue/dev-ssr.ts", injectClientScript: true, exclude })],
  define: { SPIKE_INSTRUMENT: JSON.stringify(process.env.SPIKE_INSTRUMENT === "1") },
  css: {
    modules: {
      generateScopedName: (name: string, filename: string) =>
        `${name}_${createHash("sha256").update(`${relative(repoRoot, filename.split("?")[0])}:${name}`).digest("hex").slice(0, 8)}`,
    },
  },
  build: isSsrBuild
    ? { outDir: "dist/server", ssrEmitAssets: false }
    : {
        outDir: "dist/client",
        manifest: true,
        rollupOptions: {
          input: ["src/glue/boot.ts", "src/glue/styles.ts", "src/islands/Counter.tsx", "src/islands/Search.tsx"],
          preserveEntrySignatures: "exports-only",
          output: { manualChunks: (id: string) => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? "react-runtime" : undefined) },
        },
      },
}));
