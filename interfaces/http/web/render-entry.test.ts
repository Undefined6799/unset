// The production render loader (P1.23c; architecture Amendments 2026-10-06 21:05Z and 21:45Z): the web server starts
// only with apps/web's server build in place, loaded through the literal `@unset/apps-web/server` export.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, test } from "vitest";
import { loadWebRender } from "./render-entry.ts";

const WEB = fileURLToPath(new URL("../../../apps/web/", import.meta.url));
const missing = () => Promise.reject(Object.assign(new Error("Cannot find module"), { code: "ERR_MODULE_NOT_FOUND" }));

test("ssr_loader_fails_startup_when_missing", async () => {
  await expect(loadWebRender(missing)).rejects.toThrow(/did not load; run npm run build/);
  await expect(loadWebRender(async () => ({ renderPage: (() => "") as never }))).rejects.toThrow(
    /does not export renderPage and islandName/,
  );
  const good = { renderPage: (() => ({ html: "", tooLarge: [] })) as never, islandName: (() => "x") as never };
  await expect(loadWebRender(async () => good)).resolves.toEqual(good);
});

test("ssr_loader_loads_the_real_build", async () => {
  // The same server build `npm run build -w @unset/apps-web` runs, written to the fixed place the export names.
  await build({ configFile: join(WEB, "vite.config.ts"), root: WEB, logLevel: "silent", build: { ssr: "render.tsx" } });
  const render = await loadWebRender();
  expect(render.islandName("src/islands/demo.island.tsx")).toBe("demo");
  expect(typeof render.renderPage).toBe("function");
}, 60_000);
