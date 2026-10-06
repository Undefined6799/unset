// @ts-check
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const repoRoot = new URL("../..", import.meta.url).pathname;

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  // CSS as files, never <style>: style-src allows only /_astro/ (the default "auto" inlines small sheets).
  build: { inlineStylesheets: "never" },
  vite: {
    css: {
      modules: {
        generateScopedName: (name, filename) =>
          `${name}_${createHash("sha256").update(`${relative(repoRoot, filename.split("?")[0])}:${name}`).digest("hex").slice(0, 8)}`,
        // Measurement only: record each CSS Module's class map per build (client and server) for step 4b.i.
        ...(process.env.SPIKE_MAPS
          ? {
              getJSON: (file, json) => {
                mkdirSync("dist-maps", { recursive: true });
                writeFileSync(`dist-maps/${Date.now()}-${Math.random().toString(36).slice(2)}.json`, JSON.stringify({ file: relative(process.cwd(), file), json }));
              },
            }
          : {}),
      },
    },
  },
});
