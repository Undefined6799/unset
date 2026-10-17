import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expectHeaderMenuCloses, pageNoise, watch } from "./observe.ts";
import { FIXTURES, PAGES, TEST_ORIGIN } from "./pages.ts";

function toastChunk(): string {
  const manifestPath = join(import.meta.dirname, "../../apps/web/dist/client/.vite/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, { file?: string }>;
  const entry = Object.entries(manifest).find(([key]) => key.endsWith("/toast.island.tsx"));
  const file = entry?.[1].file;
  if (file === undefined || !file.startsWith("assets/")) throw new Error("toast island chunk is not in the web build");
  return file;
}

for (const fixture of PAGES.filter((page) => page.group === "public")) {
  test(`public_pages_no_csp_violations ${fixture.path}`, async ({ page }) => {
    const watched = watch(page);
    const response = await page.goto(fixture.path);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const noise = await pageNoise(page, watched);
    expect(noise.csp).toEqual([]);
    expect(watched.pageErrors).toEqual([]);
  });
}

test("csp_violation_detected", async ({ page }) => {
  const watched = watch(page);
  const response = await page.goto(`${TEST_ORIGIN}${FIXTURES.inline}`);
  expect(response?.status()).toBe(200);
  const noise = await pageNoise(page, watched);
  expect(noise.csp.length).toBeGreaterThan(0);
});

test("csp_no_violations", async ({ page }) => {
  const watched = watch(page);
  const response = await page.goto(`${TEST_ORIGIN}${FIXTURES.app}`);
  expect(response?.status()).toBe(200);
  const close = page.locator("[data-island='toast'] a");
  await close.focus();
  await close.click();
  await expect(page.locator("#notice")).toBeHidden();
  const noise = await pageNoise(page, watched);
  expect(noise.csp).toEqual([]);
  expect(watched.pageErrors).toEqual([]);
});

test("bootstrap_isolates_failure", async ({ page }) => {
  const file = toastChunk();
  await page.route(`**/${file}`, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "missing" }));
  const watched = watch(page);
  const response = await page.goto(`${TEST_ORIGIN}${FIXTURES.app}`);
  expect(response?.status()).toBe(200);
  await expectHeaderMenuCloses(page);
  expect(watched.pageErrors).toEqual([]);
  expect(watched.consoleErrors.some((text) => text.startsWith("island.static"))).toBe(true);
  const noise = await pageNoise(page, watched);
  expect(noise.csp).toEqual([]);
});
