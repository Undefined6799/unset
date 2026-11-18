// The CSP and Trusted Types policy in the browser (P1.26; on the SvelteKit server since P1.20k, ADR 0054): every page
// loads, and every app page starts SvelteKit's client, with no violation; the watcher sees one when there is one; and
// an app page whose script fails to load is still the server's working page.
import { expect, test } from "@playwright/test";
import { openPage, pageNoise, watch } from "./observe.ts";
import { ALL_PAGES, PAGES } from "./pages.ts";

for (const fixture of ALL_PAGES) {
  test(`pages_no_csp_violations ${fixture.path}`, async ({ page }) => {
    const watched = watch(page);
    const response = await openPage(page, fixture);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const noise = await pageNoise(page, watched);
    expect(noise.csp).toEqual([]);
    expect(watched.pageErrors).toEqual([]);
    if (fixture.expectJs) expect(watched.scripts.length).toBeGreaterThan(0);
  });
}

// The watcher's own check: a style element the policy refuses (style-src lists the build's files only) is reported.
test("csp_violation_detected", async ({ page }) => {
  const watched = watch(page);
  const login = PAGES.find((entry) => entry.path === "/login");
  if (login === undefined) throw new Error("/login is not in PAGES");
  expect((await openPage(page, login))?.status()).toBe(200);
  await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: DocumentLike }).document;
    const style = doc.createElement("style");
    style.textContent = "main { color: red; }";
    doc.head.append(style);
  });
  await expect.poll(() => watched.csp.length).toBeGreaterThan(0);
});

// With its script refused, an app page is the server's page: the sign-in form is there, and the only error is
// SvelteKit's startup script reporting the import that failed.
test("app_page_works_without_its_script", async ({ page }) => {
  await page.route("**/_app/**/*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
  const watched = watch(page);
  const login = PAGES.find((entry) => entry.path === "/login");
  if (login === undefined) throw new Error("/login is not in PAGES");
  expect((await openPage(page, login))?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Sign in with AtProto" })).toBeVisible();
  expect(watched.pageErrors).toHaveLength(1);
  expect(watched.pageErrors[0]).toMatch(/^Failed to fetch dynamically imported module: .*\/_app\/immutable\//);
  const noise = await pageNoise(page, watched);
  expect(noise.csp).toEqual([]);
});

type DocumentLike = {
  createElement: (tag: string) => { textContent: string };
  head: { append: (node: object) => void };
};
