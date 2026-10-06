// The production render loader (P1.23c): the web server starts only with apps/web's server build in place, read from
// one fixed path (architecture Amendment 2026-10-06 21:05Z).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";
import { loadWebRender, WEB_RENDER_FILE } from "./render-entry.ts";

const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "web-render-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const file = (name: string, text?: string) => {
  const path = join(temp, name);
  if (text !== undefined) writeFileSync(path, text);
  return path;
};

test("ssr_loader_fails_startup_when_missing", async () => {
  await expect(loadWebRender(file("absent.js"))).rejects.toThrow(/absent\.js is missing/);
  await expect(loadWebRender(file("partial.js", "export const renderPage = 1;\n"))).rejects.toThrow(
    /does not export renderPage and islandName/,
  );
  const built = file("render.js", "export function renderPage() {}\nexport function islandName() {}\n");
  await expect(loadWebRender(built)).resolves.toMatchObject({ renderPage: expect.any(Function) });
  // The default is the one fixed place the server build is written to and the image copies it to.
  expect(relative(REPOSITORY, WEB_RENDER_FILE).split("\\").join("/")).toBe("apps/web/dist/server/render.js");
});
