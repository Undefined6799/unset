// The site header sticks to the top of the page as it scrolls (Alex, 2026-11-20), on a desktop and a phone, in the core
// shell and the site shell. Its height is app.css's --site-header-height, which a bar under it and the page's
// scroll-padding use, so the two must stay equal; an anchor scrolls in below the header, not under it; and a dialog
// still draws over it.
import { expect, type Page, test } from "@playwright/test";
import { MAIN_MENU, menuButton } from "./navbar.ts";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture } from "./pages.ts";
import { phone } from "./phone.ts";

const CORE: PageFixture = { path: "/legal/privacy", route: "/legal/:document", group: "public", expectJs: true };
const SITE: PageFixture = { path: "/signed-out", route: "/signed-out", group: "app", expectJs: true };
const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};

const header = (page: Page) => page.locator("[data-site-header]");

// The browser's own objects, as far as these checks touch them (the tests' tsconfig has no DOM lib).
type El = {
  id: string;
  textContent: string;
  style: { height: string };
  append: (...nodes: El[]) => void;
  remove: () => void;
  getBoundingClientRect: () => { height: number };
  closest: (selector: string) => El | null;
};
type Win = {
  document: {
    body: El;
    documentElement: { scrollHeight: number };
    querySelector: (selector: string) => El | null;
    createElement: (tag: string) => El;
    elementFromPoint: (x: number, y: number) => El | null;
  };
  location: { hash: string };
  scrollTo: (x: number, y: number) => void;
};

/** The header's height as drawn, and --site-header-height as the root resolves it, in px. */
async function heights(page: Page): Promise<{ drawn: number; token: number }> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as Win).document;
    const probe = doc.createElement("div");
    probe.style.height = "var(--site-header-height)";
    doc.body.append(probe);
    const token = probe.getBoundingClientRect().height;
    probe.remove();
    const drawn = doc.querySelector("[data-site-header]")?.getBoundingClientRect().height ?? -1;
    return { drawn, token };
  });
}

/**
 * Makes the page taller than the screen, with an anchor in the middle that can scroll to the top. Added once the page
 * has settled, so SvelteKit's hydration, where its client runs, cannot drop them.
 */
async function lengthen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doc = (globalThis as unknown as Win).document;
    const spacer = doc.createElement("div");
    spacer.style.height = "3000px";
    const target = doc.createElement("p");
    target.id = "sticky-target";
    target.textContent = "Target";
    const after = doc.createElement("div");
    after.style.height = "3000px";
    doc.querySelector("main")?.append(spacer, target, after);
  });
}

async function expectSticky(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const { drawn, token } = await heights(page);
  expect(token).toBeGreaterThan(0);
  expect(Math.abs(drawn - token)).toBeLessThanOrEqual(0.5);
  await lengthen(page);
  await page.evaluate(() => {
    (globalThis as unknown as Win).location.hash = "sticky-target";
  });
  // The anchor lands just below the header (scroll-padding-top), not under it. Polled: where SvelteKit's client runs, its router handles
  // the hash change and scrolls a moment later.
  await expect
    .poll(async () => {
      const target = await page.locator("#sticky-target").boundingBox();
      return target !== null && Math.abs(target.y - token) <= 1;
    })
    .toBe(true);
  expect((await header(page).boundingBox())?.y).toBe(0);
  // At the very end, with the footer in view, the header is still at the top.
  await page.evaluate(() => {
    const view = globalThis as unknown as Win;
    view.scrollTo(0, view.document.documentElement.scrollHeight);
  });
  await expect(page.locator("footer")).toBeInViewport();
  expect((await header(page).boundingBox())?.y).toBe(0);
}

for (const [name, fixture] of [
  ["core", CORE],
  ["site", SITE],
] as const) {
  test(`the_${name}_shell_header_sticks_at_its_named_height`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    expect((await openPage(page, fixture))?.status()).toBe(200);
    await expectSticky(page);
  });

  test.describe("phone", () => {
    test.use(phone({ width: 320, height: 640 }));

    test(`the_${name}_shell_header_sticks_on_a_phone`, async ({ page }) => {
      expect((await openPage(page, fixture))?.status()).toBe(200);
      await expectSticky(page);
    });
  });
}

// A dialog draws over the sticky header: the avatar's Shape dialog covers the header's menu button.
test("a_dialog_draws_over_the_sticky_header", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Change picture shape" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const menu = await menuButton(page, MAIN_MENU).boundingBox();
  expect(menu).not.toBeNull();
  const on = await page.evaluate(
    ({ x, y }) => {
      const hit = (globalThis as unknown as Win).document.elementFromPoint(x, y);
      return hit !== null && hit.closest("[data-site-header]") !== null;
    },
    { x: (menu?.x ?? 0) + 4, y: (menu?.y ?? 0) + 4 },
  );
  expect(on).toBe(false);
  await page.keyboard.press("Escape");
});
