// Real Chromium touch input: Playwright 1.64.1 BrowserContext.newCDPSession and
// playwright-core/types/protocol.d.ts Input.dispatchTouchEvent. The harness excludes *.chromium.spec.ts elsewhere.
import { expect, test } from "@playwright/test";
import { pageNoise, watch } from "./observe.ts";
import { TEST_ORIGIN } from "./pages.ts";

const MOVING = "Move this paragraph with the block actions.";
const NEIGHBOR = "The next paragraph stays readable after a move.";

for (const cancelled of [false, true]) {
  test(`editor_touch_hold_drag_${cancelled ? "cancel_preserves_order" : "reorders_and_undo_restores"}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 900, height: 900 },
      hasTouch: true,
      isMobile: true,
      extraHTTPHeaders: { "accept-language": "en" },
    });
    try {
      const page = await context.newPage();
      const watched = watch(page);
      const response = await page.goto(`${TEST_ORIGIN}/fixture/editor`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-security-policy"]).toContain("require-trusted-types-for 'script'");
      await page.getByRole("button", { name: "Edit README", exact: true }).tap();
      await expect(page.locator("form[data-readme-editor]")).toHaveAttribute("data-ready", "true");
      const editor = page.locator("[data-editor-root]");
      const paragraphs = editor.locator('[data-content-type="paragraph"]');
      const moving = paragraphs.filter({ hasText: MOVING });
      const neighbor = paragraphs.filter({ hasText: NEIGHBOR });
      const before = await paragraphs.allTextContents();
      await moving.scrollIntoViewIfNeeded();
      const start = await moving.boundingBox();
      if (start === null) throw new Error("The source block must be visible for the touch gesture");
      const client = await context.newCDPSession(page);
      const point = { x: start.x + start.width - 4, y: start.y + start.height / 2, id: 1 };
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      if (!cancelled) {
        // A small finger drift establishes native implicit capture before the held drag takes capture itself.
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...point, y: point.y + 2 }],
        });
      }
      // Wait for the hold feedback, not a fixed sleep; the small drift stays below the swipe threshold.
      await expect(editor.locator("[data-touch-dragging]")).toHaveCount(1);
      const target = await neighbor.boundingBox();
      if (target === null) throw new Error("The target block must be visible for the touch gesture");
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...point, x: target.x + target.width - 4, y: target.y + target.height - 3 }],
      });
      await expect(editor.locator('[data-touch-drop="after"]')).toContainText(NEIGHBOR);
      await client.send("Input.dispatchTouchEvent", { type: cancelled ? "touchCancel" : "touchEnd", touchPoints: [] });
      await expect(editor.locator("[data-touch-dragging], [data-touch-drop]")).toHaveCount(0);
      if (cancelled) {
        await expect(paragraphs).toHaveText(before);
      } else {
        await expect
          .poll(async () => {
            const order = await paragraphs.allTextContents();
            return order.indexOf(MOVING) - order.indexOf(NEIGHBOR);
          })
          .toBeGreaterThan(0);
        await editor.getByRole("textbox", { name: "README", exact: true }).focus();
        await page.keyboard.press("ControlOrMeta+z");
        await expect(paragraphs).toHaveText(before);
      }
      await expect(page.getByRole("dialog", { name: "Block actions", exact: true })).toBeHidden();
      const noise = await pageNoise(page, watched);
      expect(noise.csp).toEqual([]);
      expect(watched.pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
