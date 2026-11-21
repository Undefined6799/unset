// The profile header (ADR 0072, P1.21o; the only layout since ADR 0077): the avatar and name above the cards, and the
// avatar opens the profile's About panel (handle, details) in a native popover under it. The popover works with no
// script (the public page runs none), so the same checks run with the client and without it.
import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture } from "./pages.ts";
import { phone } from "./phone.ts";

const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};
async function ownPage(page: Page): Promise<void> {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
}

/** A Contact card whose one button has a 40-grapheme label, the editor's limit (review of #1825). */
const LONG_LABEL = "Book a long talk about trains and places";
async function withLongContact(page: Page): Promise<void> {
  const status = await page.evaluate(async (label) => {
    const body = new URLSearchParams([
      ["kind", "buttons"],
      ["width", "full"],
      ["heading", "Say hello"],
      ["buttons.0.kind", "link"],
      ["buttons.0.preset", "custom"],
      ["buttons.0.uri", "https://example.com/talk"],
      ["buttons.0.label", label],
    ]);
    const init = { method: "POST", body, headers: { accept: "text/html" }, redirect: "manual" } as const;
    const answer = await fetch("?/create", init);
    return answer.type === "opaqueredirect" ? 303 : answer.status;
  }, LONG_LABEL);
  expect(status).toBe(303);
  await page.reload();
  await page.waitForLoadState("networkidle");
}

async function removeContact(page: Page): Promise<void> {
  const card = page.getByRole("group", { name: "Say hello card" });
  await card.getByRole("button", { name: "More for Say hello card" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
}

const avatar = (page: Page) => page.getByRole("button", { name: /^About / });
const details = (page: Page) => page.getByRole("region", { name: "About" });

test("the_header_opens_its_details_and_keeps_editing_separate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ownPage(page);
  // The name stays in the header; the handle and the details wait in the About panel (Alex 2026-11-20).
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Handle", { exact: true })).toBeHidden();
  await expect(details(page)).toBeHidden();
  await expect(page.getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/settings/profile");
  await expect(page.getByRole("link", { name: "Change picture shape" })).toBeVisible();
  // View as public opens the page a visitor gets (routes/@[actor]), not a copy of the owner's page.
  await expect(page.getByRole("link", { name: "View as public" })).toHaveAttribute("href", `/@${ACCOUNT.did}`);
  // A new tab, so the owner's page stays open as the way back; the public route reads no session.
  await expect(page.getByRole("link", { name: "View as public" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Add card" })).toBeVisible();

  // A click opens it under the avatar, Escape closes it and focus is back on the avatar.
  await avatar(page).click();
  await expect(details(page)).toBeVisible();
  const from = await avatar(page).boundingBox();
  const panel = await details(page).boundingBox();
  expect(from !== null && panel !== null && panel.y >= from.y + from.height).toBe(true);
  await expect(details(page).getByText("DID", { exact: true })).toBeVisible();
  await expect(details(page).getByText("Handle", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details(page)).toBeHidden();
  await expect(avatar(page)).toBeFocused();

  // Enter opens it, its Close button closes it, and a click outside closes it too.
  await page.keyboard.press("Enter");
  await expect(details(page)).toBeVisible();
  await details(page).getByRole("button", { name: "Close details" }).click();
  await expect(details(page)).toBeHidden();
  await avatar(page).click();
  await page.mouse.click(1200, 880);
  await expect(details(page)).toBeHidden();

  // The avatar's editor is its own control, and opens the same dialog as before.
  await page.getByRole("link", { name: "Change picture shape" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});

test.describe("no script", () => {
  test.use({ javaScriptEnabled: false });

  test("the_details_work_with_no_script", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await ownPage(page);
    await avatar(page).click();
    await expect(details(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details(page)).toBeHidden();
    await avatar(page).focus();
    await page.keyboard.press(" ");
    await expect(details(page)).toBeVisible();
    await details(page).getByRole("button", { name: "Close details" }).click();
    await expect(details(page)).toBeHidden();
  });
});

test.describe("phone", () => {
  test.use(phone({ width: 320, height: 800 }));

  test("the_details_stay_on_screen_and_nothing_scrolls_sideways", async ({ page }) => {
    await ownPage(page);
    await withLongContact(page);
    await avatar(page).tap();
    await expect(details(page)).toBeVisible();
    const box = await details(page).boundingBox();
    expect(box !== null && box.x >= 0 && box.x + box.width <= 320).toBe(true);
    // The longest Contact label wraps inside the panel instead of running past its edge.
    const action = await details(page).getByRole("link", { name: LONG_LABEL }).boundingBox();
    expect(box !== null && action !== null && action.x + action.width <= box.x + box.width).toBe(true);
    await page.keyboard.press("Escape");
    await removeContact(page);
    const width = await page.evaluate(() => {
      const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document;
      return root.documentElement.scrollWidth;
    });
    expect(width).toBeLessThanOrEqual(320);
  });
});
