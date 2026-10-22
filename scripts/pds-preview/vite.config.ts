// Dev-only PDS page preview. Vite 8.3.4 UserConfig (node_modules/vite/dist/node/index.d.ts).

import { defineConfig } from "vite";
import { scopedName } from "../ui/css-scope.ts";

export default defineConfig({
  root: import.meta.dirname,
  appType: "spa",
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
  oxc: { jsx: { runtime: "automatic", importSource: "react", development: false } },
  css: { modules: { generateScopedName: scopedName } },
});
