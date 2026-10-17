// Chromium-only kit checks. Clipboard permissions and forced-colors emulation are not
// available in the Firefox and WebKit projects (playwright.config.ts testIgnore).
import { expect, test } from "@playwright/test";
import { FIXTURES, TEST_ORIGIN } from "./pages.ts";

const SHOWCASE = `${TEST_ORIGIN}${FIXTURES.showcase}`;

test.describe("clipboard granted", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("commandblock_copy_announces", async ({ page }) => {
    await page.goto(SHOWCASE);
    await page.getByRole("button", { name: "copy" }).click();
    await expect(page.locator('[aria-live="polite"]', { hasText: "Copied" })).toHaveCount(1);
    const copied = await page.evaluate(() => {
      const nav = (globalThis as unknown as { navigator: { clipboard: { readText: () => Promise<string> } } })
        .navigator;
      return nav.clipboard.readText();
    });
    expect(copied).toBe("unset login alex.example");
  });
});

test("commandblock_copy_denied_announces", async ({ page }) => {
  await page.goto(SHOWCASE);
  await page.getByRole("button", { name: "copy" }).click();
  await expect(page.locator('[aria-live="polite"]', { hasText: "Copy failed" })).toHaveCount(1);
});

test.describe("forced colours", () => {
  test.use({ forcedColors: "active" });

  test("checkbox_forced_colors_native", async ({ page }) => {
    await page.goto(SHOWCASE);
    const appearance = await page
      .locator('input[type="checkbox"]')
      .first()
      .evaluate((element) => {
        const view = globalThis as unknown as { getComputedStyle: (node: object) => { appearance: string } };
        return view.getComputedStyle(element).appearance;
      });
    expect(appearance).toBe("auto");
  });
});
