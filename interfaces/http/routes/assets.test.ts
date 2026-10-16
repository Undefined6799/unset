// GET /assets/<file> through the composed web server (P1.23; architecture ruling 2026-10-06's four tests).
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { loadConfig } from "@unset/shared-config";
import { afterAll, describe, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import { webTestEnv } from "../test-env.ts";

// A build directory: the committed test manifest, the files it lists, and one file it does not list.
const BUILD = mkdtempSync(join(tmpdir(), "web-build-"));
afterAll(() => rmSync(BUILD, { recursive: true, force: true }));
cpSync(fileURLToPath(new URL("../web/testdata/.vite/", import.meta.url)), join(BUILD, ".vite"), { recursive: true });
mkdirSync(join(BUILD, "assets"));
const FILES: Record<string, string> = {
  "runtime-T3st0001.js": "export const runtime = 1;\n",
  "boot-T3st0002.js": "export const boot = 1;\n",
  "demo.island-T3st0003.js": "export const demo = 1;\n",
  "notes-T3st0004.txt": "listed, but its extension is not served\n",
  "stray-T3st0005.js": "not listed in the manifest\n",
};
for (const [name, text] of Object.entries(FILES)) writeFileSync(join(BUILD, "assets", name), text);
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const ENV = webTestEnv(SECRETS, { WEB_BUILD_DIR: BUILD });
const { server } = await compose(loadConfig(config, ENV), web);
const get = (path: string, method = "GET") =>
  server.request(new Request(`https://unset.test${path}`, { method, headers: { host: "unset.test" } }), "10.0.0.1");

describe("GET /assets/<file>", () => {
  test("assets_serves_manifest_file", async () => {
    const response = await get("/assets/boot-T3st0002.js");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FILES["boot-T3st0002.js"]);
    const head = await get("/assets/boot-T3st0002.js", "HEAD");
    expect([head.status, await head.text()]).toEqual([200, ""]);
  });

  test("content_type_fixed_with_nosniff", async () => {
    const response = await get("/assets/demo.island-T3st0003.js");
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  test("hashed_asset_immutable", async () => {
    const response = await get("/assets/runtime-T3st0001.js");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  test("unlisted_file_404", async () => {
    // On disk, but not in the manifest: never served. Neither is the manifest itself.
    const unlisted = ["/assets/stray-T3st0005.js", "/assets/manifest.json", "/assets/missing.js", "/assets/"];
    for (const path of unlisted) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      if (path !== "/assets/") expect(response.headers.get("cache-control"), path).toBe("no-cache");
    }
  });

  test("traversal_refused", async () => {
    for (const path of [
      "/assets/..%2f.vite%2fmanifest.json",
      "/assets/%2e%2e/.vite/manifest.json",
      "/assets/%2e%2e%2fboot-T3st0002.js",
      "/assets/.%2fboot-T3st0002.js",
      "/assets/boot-T3st0002.js%00",
      "/assets//etc/passwd",
    ]) {
      const response = await get(path);
      expect([400, 404], path).toContain(response.status);
      expect(await response.text(), path).not.toContain("assets/");
    }
  });

  test("assets_rejects_bad_extension", async () => {
    expect((await get("/assets/notes-T3st0004.txt")).status).toBe(404);
  });

  test("assets_no_post", async () => {
    const response = await server.request(
      new Request("https://unset.test/assets/boot-T3st0002.js", { method: "POST", headers: { host: "unset.test" } }),
      "10.0.0.1",
    );
    expect(response.status).toBe(405);
  });
});
