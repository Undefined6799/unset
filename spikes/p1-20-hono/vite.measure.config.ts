// Measurement only (not glue, not shipped): records each build's CSS Module class maps for the identity check.
import { mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";

const maps: Record<string, Record<string, string>> = {};

export default defineConfig((env) =>
  mergeConfig(base(env), {
    css: {
      modules: {
        getJSON: (file: string, json: Record<string, string>) => {
          maps[relative(process.cwd(), file)] = json;
          mkdirSync("dist/css-maps", { recursive: true });
          writeFileSync(`dist/css-maps/${env.isSsrBuild ? "server" : "client"}.json`, JSON.stringify(maps, null, 2));
        },
      },
    },
  }),
);
