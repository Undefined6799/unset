import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FIXTURES, type ManifestRoute, missingFromRouter, NOT_DOCUMENTS, PAGES, uncovered } from "./pages.ts";

const manifest = join(import.meta.dirname, "../../interfaces/http/routes.manifest.json");
const routes = JSON.parse(readFileSync(manifest, "utf8")) as ManifestRoute[];

describe("pages_cover_routes", () => {
  test("every document route is listed", () => {
    expect(uncovered(routes)).toEqual([]);
    expect(missingFromRouter(routes)).toEqual([]);
  });

  test("a new GET HTML route fails and is named", () => {
    expect(uncovered([...routes, { method: "GET", path: "/new-page" }])).toEqual(["/new-page"]);
  });

  test("a POST is not a page", () => {
    expect(uncovered([...routes, { method: "POST", path: "/new-page" }])).toEqual([]);
  });

  test("exclusions are real routes and fixtures are not", () => {
    const gets = new Set(routes.filter((route) => route.method === "GET").map((route) => route.path));
    for (const entry of NOT_DOCUMENTS) expect(gets.has(entry.path), entry.path).toBe(true);
    for (const path of Object.values(FIXTURES)) expect(gets.has(path), path).toBe(false);
  });

  test("fixture groups match the manifest", () => {
    for (const page of PAGES) {
      const route = routes.find((entry) => entry.method === "GET" && entry.path === page.path);
      expect(route?.group, page.path).toBe(page.group);
    }
  });
});
