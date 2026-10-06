// apps/web's render entry as production runs it (P1.23c; ADR 0015; step book record 2026-10-06-p123c-css-modules-glue.md):
// the server build `vite build --ssr render.tsx` writes dist/server/render.js, plain JavaScript with the CSS Module
// class maps compiled in, so the web server runs no Vite and no TypeScript. This is the one loader, and it reads one
// fixed path (architecture Amendment 2026-10-06 21:05Z): no config key or environment variable moves the code the
// server loads, and P1.27's image puts the build there. A missing or malformed build fails startup. Tests import the
// source and pass it to compose() instead; Vitest compiles it with the same class names (scripts/ui/css-scope.ts).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { islandName, renderPage } from "@unset/apps-web";

/** What the web server uses from apps/web's render entry. */
export type WebRender = Readonly<{ renderPage: typeof renderPage; islandName: typeof islandName }>;

/** apps/web's server build, at its place beside this package in the repository and in the image. */
export const WEB_RENDER_FILE = fileURLToPath(new URL("../../../apps/web/dist/server/render.js", import.meta.url));

/** Imports the server build; throws when it is missing or lacks the render entry's exports, so startup fails closed. */
export async function loadWebRender(file: string = WEB_RENDER_FILE): Promise<WebRender> {
  if (!existsSync(file)) throw new Error(`web render build: ${file} is missing; run npm run build -w @unset/apps-web`);
  const module = (await import(pathToFileURL(file).href)) as Partial<WebRender>;
  if (typeof module.renderPage !== "function" || typeof module.islandName !== "function") {
    throw new Error(`web render build: ${file} does not export renderPage and islandName`);
  }
  return { renderPage: module.renderPage, islandName: module.islandName };
}
