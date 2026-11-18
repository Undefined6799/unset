// pages_cover_routes (P1.26; on interfaces/web's route folders since P1.20k): every document route is a page under
// test or named in NOT_DOCUMENTS with a reason.
import { describe, expect, test } from "vitest";
import { ALL_PAGES, kitRoutes, missingFromRouter, NOT_DOCUMENTS, uncovered } from "./pages.ts";

const routes = kitRoutes();

describe("pages_cover_routes", () => {
  test("every document route is listed", () => {
    expect(uncovered(routes)).toEqual([]);
    expect(missingFromRouter(routes)).toEqual([]);
  });

  test("the route folders are read as routes", () => {
    const documents = routes.filter((entry) => entry.document).map((entry) => entry.route);
    expect(documents).toContain("/:did");
    expect(documents).toContain("/legal/:document");
    expect(routes.some((entry) => entry.route === "/.well-known/security.txt" && !entry.document)).toBe(true);
  });

  test("a new document route fails and is named", () => {
    expect(uncovered([...routes, { route: "/new-page", document: true }])).toEqual(["/new-page"]);
  });

  test("an endpoint is not a page", () => {
    expect(uncovered([...routes, { route: "/new-endpoint", document: false }])).toEqual([]);
  });

  test("exclusions are real document routes", () => {
    const documents = new Set(routes.filter((entry) => entry.document).map((entry) => entry.route));
    for (const entry of NOT_DOCUMENTS) expect(documents.has(entry.route), entry.route).toBe(true);
  });

  test("page groups match the route policies", () => {
    for (const page of ALL_PAGES) {
      const route = routes.find((entry) => entry.document && entry.route === page.route);
      expect(route?.group, page.path).toBe(page.group);
    }
  });
});
