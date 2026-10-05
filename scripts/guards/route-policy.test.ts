// The route-policy guard (P1.06q) on the real tree and on edge cases its fixtures do not cover. The fixtures, one per
// failure the architecture ruling of 2026-10-05 names, run in guards.test.ts with the other guards (AB-4).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { scanAll, scanRoutePolicy } from "./route-policy.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tempRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "route-policy-"));
  temps.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const HEALTH = { method: "GET", path: "/health", group: "static", rateLimit: "exempt" };
const manifest = (...routes: object[]) => JSON.stringify([HEALTH, ...routes]);
const texts = async (root: string) => (await scanAll(root)).map((f) => `${f.file}: ${f.text}`);

describe("route-policy", () => {
  test("every_route_has_policy", async () => {
    const { findings } = await scanRoutePolicy(ROOT);
    expect(findings).toEqual([]);
  });

  test("unparsable_manifest_fails", async () => {
    const root = tempRepo({ "interfaces/http/routes.manifest.json": "[{" });
    expect(await texts(root)).toEqual(["interfaces/http/routes.manifest.json: unparsable routes manifest"]);
  });

  test("manifest_not_array_fails", async () => {
    const root = tempRepo({ "interfaces/http/routes.manifest.json": "{}" });
    expect(await texts(root)).toEqual(["interfaces/http/routes.manifest.json: routes manifest is not an array"]);
  });

  test("route_without_group_fails", async () => {
    const root = tempRepo({
      "interfaces/http/routes.manifest.json": manifest({ method: "GET", path: "/a", rateLimit: "exempt" }),
    });
    expect(await texts(root)).toEqual(["interfaces/http/routes.manifest.json: GET /a: no group"]);
  });

  test("policies_not_plain_object_fails", async () => {
    const root = tempRepo({
      "interfaces/http/routes.manifest.json": manifest(),
      "interfaces/http/limits.ts": "export const policies = [];",
    });
    expect(await texts(root)).toEqual(["interfaces/http/limits.ts: `policies` in limits.ts is not a plain object"]);
  });

  test("folder_without_manifest_ignored_but_others_checked", async () => {
    const root = tempRepo({
      "interfaces/pds-admin/pds.mjs": "",
      "interfaces/api/routes.manifest.json": manifest({ method: "GET", path: "/x", group: "app", rateLimit: "d" }),
    });
    expect(await texts(root)).toEqual([
      'interfaces/api/routes.manifest.json: GET /x: names "d" but interfaces/api/limits.ts does not exist',
    ]);
  });

  test("unused_policy_only_warns", async () => {
    const root = tempRepo({
      "interfaces/http/routes.manifest.json": manifest({ method: "GET", path: "/a", group: "app", rateLimit: "a" }),
      "interfaces/http/limits.ts": "export const policies = { a: [], spare: [] };",
    });
    expect(await scanRoutePolicy(root)).toEqual({
      findings: [],
      warnings: ['interfaces/http/limits.ts: policy "spare" is used by no route'],
    });
  });
});
