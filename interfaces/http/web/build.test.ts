// The startup read of apps/web's build (P1.23): one parse, file names only, and no startup without it. The committed
// testdata holds only the manifest; nothing here reads the files it names.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { loadConfig } from "@unset/shared-config";
import { afterAll, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import { webTestEnv } from "../test-env.ts";
import { loadWebBuild, parseWebBuild } from "./build.ts";

const TESTDATA = fileURLToPath(new URL("./testdata/", import.meta.url));
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const ENV = webTestEnv(SECRETS);
const BOOT = "src/islands/runtime/bootstrap.ts";
const empty = mkdtempSync(join(tmpdir(), "web-build-"));
afterAll(() => rmSync(empty, { recursive: true, force: true }));

const STYLES = "src/styles.ts";
const manifestWith = (chunks: Record<string, unknown>) =>
  JSON.stringify({
    [BOOT]: { file: "assets/boot-1.js", isEntry: true },
    [STYLES]: { file: "assets/styles-1.js", isEntry: true },
    ...chunks,
  });

test("web_build_parsed_once_for_route_and_render", () => {
  const build = loadWebBuild(TESTDATA, web.islandName);
  expect(build.manifest.boot).toBe("assets/boot-T3st0002.js");
  expect([...build.manifest.islands]).toEqual([
    ["demo", ["assets/demo.island-T3st0003.js", "assets/runtime-T3st0001.js", "assets/boot-T3st0002.js"]],
  ]);
  expect([...build.files.keys()].sort()).toEqual([
    "Display-T3st0007.woff2",
    "Mono-T3st0009.woff2",
    "boot-T3st0002.js",
    "demo.island-T3st0003.js",
    "logo-T3st0008.svg",
    "notes-T3st0004.txt",
    "runtime-T3st0001.js",
    "styles-T3st0005.js",
    "styles-T3st0006.css",
  ]);
  expect(build.manifest.styles).toEqual(["assets/styles-T3st0006.css"]);
  // Only the styles entry's woff2 files are fonts to preload; its other assets are served but not preloaded.
  expect(build.manifest.fonts).toEqual(["assets/Display-T3st0007.woff2", "assets/Mono-T3st0009.woff2"]);
  expect(build.files.get("boot-T3st0002.js")).toBe(join(TESTDATA, "assets/boot-T3st0002.js"));
});

test("web_build_refuses_bad_names", () => {
  for (const file of ["../secret.js", "/etc/passwd", "assets/../x.js", "assets/a/b.js", "assets/", "x.js"]) {
    expect(() => parseWebBuild(manifestWith({ x: { file } }), "/b", web.islandName), file).toThrow(
      /web build manifest/,
    );
    expect(
      () => parseWebBuild(manifestWith({ x: { file: "assets/x.js", css: [file] } }), "/b", web.islandName),
      file,
    ).toThrow();
  }
  for (const text of ["[]", "null", "{}", '{"x":1}', manifestWith({ x: { file: "assets/x.js", imports: [1] } })]) {
    expect(() => parseWebBuild(text, "/b", web.islandName), text).toThrow();
  }
  const dangling = manifestWith({ "src/islands/a.island.tsx": { file: "assets/a.js", imports: ["_gone.js"] } });
  expect(() => parseWebBuild(dangling, "/b", web.islandName)).toThrow(/unknown import/);
});

test("manifest_missing_fails_startup", async () => {
  await expect(compose(loadConfig(config, { ...ENV, WEB_BUILD_DIR: empty }), web)).rejects.toThrow(/ENOENT/);
  const original = readFileSync(join(TESTDATA, ".vite/manifest.json"), "utf8");
  expect(() => parseWebBuild(original.slice(0, -10), TESTDATA, web.islandName)).toThrow(SyntaxError);
  await expect(compose(loadConfig(config, { ...ENV, WEB_BUILD_DIR: TESTDATA }), web)).resolves.toBeDefined();
});
