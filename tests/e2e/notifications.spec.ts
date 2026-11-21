// P2.27b (ADR 0081): the notifications page as Alex shaped it on the mock-up (2026-11-21). It fills the window below
// the header, so the footer shows only on scrolling, and the list scrolls on its own. The split between list and
// detail is dragged, or moved with the arrow keys, between 2/5 and 3/5. A cut-off row is lifted, whole, above the
// detail after the pointer rests on it, never near the drag bar, and a click still shows the row. On a phone the
// detail is its own screen. The "inbox" member (fixtures/servers.ts) has INBOX_SIZE entries; nothing here dismisses
// one (each test has its own browser context, so the split's stored width starts fresh); the integration tests own
// dismissing. Its Sign-in history tab (P2.27c) has INBOX_SIZE sign-ins, and nothing here deletes one either.
import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { BELL_SIZE, INBOX_SIZE, type PageFixture } from "./pages.ts";

const INBOX: PageFixture = {
  path: "/notifications",
  route: "/notifications",
  group: "app",
  expectJs: true,
  member: "inbox",
};

const list = (page: Page) => page.locator("#notifications-dismiss-selected");
const rows = (page: Page) => list(page).locator("li");
const bar = (page: Page) => page.getByRole("separator", { name: "Resize the list" });

async function open(page: Page) {
  expect((await openPage(page, INBOX))?.status()).toBe(200);
  await expect(bar(page)).toBeVisible(); // the client has run
}

/** The list's share of the split, in percent. */
async function share(page: Page): Promise<number> {
  const [form, split] = [await list(page).boundingBox(), await list(page).locator("xpath=..").boundingBox()];
  if (form === null || split === null) throw new Error("no split");
  return (form.width / split.width) * 100;
}

test.describe("wide screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("fills_the_window_and_the_list_scrolls_on_its_own", async ({ page }) => {
    await open(page);
    await expect(rows(page)).toHaveCount(INBOX_SIZE);
    const footer = await page.locator("footer").boundingBox();
    expect(footer?.y ?? 0).toBeGreaterThanOrEqual(800);
    const scroll = await list(page).evaluate((form) => [form.scrollHeight, form.clientHeight]);
    expect(scroll[0]).toBeGreaterThan(scroll[1] ?? 0);
    expect(await share(page)).toBeCloseTo(40, 0);
  });

  test("the_split_drags_and_stays_between_two_fifths_and_three_fifths", async ({ page }) => {
    await open(page);
    const box = await bar(page).boundingBox();
    if (box === null) throw new Error("no bar");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 900, y, { steps: 6 });
    await page.mouse.up();
    expect(await share(page)).toBeCloseTo(60, 0);
    const moved = await bar(page).boundingBox();
    if (moved === null) throw new Error("no bar");
    await page.mouse.move(moved.x + 4, y);
    await page.mouse.down();
    await page.mouse.move(0, y, { steps: 6 });
    await page.mouse.up();
    expect(await share(page)).toBeCloseTo(40, 0);
    // The keyboard moves it too, and the choice is kept on this device.
    await bar(page).focus();
    for (let n = 0; n < 5; n += 1) await page.keyboard.press("ArrowRight");
    await expect(bar(page)).toHaveAttribute("aria-valuenow", "50");
    await page.reload();
    await expect(bar(page)).toHaveAttribute("aria-valuenow", "50");
  });

  test("a_click_shows_the_entry_without_leaving_the_page", async ({ page }) => {
    await open(page);
    const second = rows(page).nth(1);
    const title = (await second.locator("[data-title]").textContent()) ?? "";
    const url = page.url();
    await second.locator("a").click();
    await expect(page.locator("#notification-detail-title")).toHaveText(title);
    expect(page.url()).toBe(url);
    await expect(second.locator("a")).toHaveAttribute("aria-current", "true");
    // Showing it removed nothing.
    await expect(rows(page)).toHaveCount(INBOX_SIZE);
  });

  test("a_bell_row_shows_its_entry_even_after_a_row_was_picked_here", async ({ page }) => {
    await open(page);
    await rows(page).nth(2).locator("a").click();
    const newest = (await rows(page).first().locator("[data-title]").textContent()) ?? "";
    const third = (await rows(page).nth(2).locator("[data-title]").textContent()) ?? "";
    await expect(page.locator("#notification-detail-title")).toHaveText(third);
    // This page has shown the list, so the bell's count is gone (ADR 0085): it names no number.
    // Its newest row: a link to ?n=<its id>, which the page keeps on screen (SvelteKit keeps its state).
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    const id = await rows(page).first().locator("input[name=id]").getAttribute("value");
    await page.locator(`[popover] a[href="/notifications?n=${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`n=${id}$`));
    await expect(page.locator("#notification-detail-title")).toHaveText(newest);
  });

  test("dismiss_selected_waits_for_a_tick", async ({ page }) => {
    await open(page);
    const button = page.getByRole("button", { name: "Dismiss selected" });
    await expect(button).toBeDisabled();
    await rows(page).first().getByRole("checkbox").check();
    await expect(button).toBeEnabled();
    await page.getByRole("checkbox", { name: "Select all" }).check();
    await expect(rows(page).getByRole("checkbox", { checked: true })).toHaveCount(INBOX_SIZE);
    await page.getByRole("checkbox", { name: "Select all" }).uncheck();
    await expect(button).toBeDisabled();
  });
});

test.describe("the bell's count", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  // The sign-ins tab marks nothing seen on its own (ADR 0085), so the count is the bell member's BELL_SIZE.
  const BELL: PageFixture = {
    ...INBOX,
    path: "/notifications/sign-ins",
    route: "/notifications/sign-ins",
    member: "bell",
  };

  test("comes_back_when_marking_it_seen_fails", async ({ page }) => {
    // Every mark fails, as on a dropped connection, so this member's count is never stored as seen.
    await page.route("**/notifications?/seen", (route) => route.abort("failed"));
    const marked = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("?/seen"));
    expect((await openPage(page, BELL))?.status()).toBe(200);
    const bell = page.getByRole("button", { name: `Notifications, ${BELL_SIZE} waiting` });
    await page.waitForLoadState("networkidle"); // the client has run, so opening the bell marks it
    await bell.click();
    await marked;
    // The mark was not stored, so the badge is back, and the next opening tries again.
    await page.keyboard.press("Escape");
    await expect(bell).toBeVisible();
  });
});

test.describe("sign-in history", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const HISTORY: PageFixture = { ...INBOX, path: "/notifications/sign-ins", route: "/notifications/sign-ins" };
  const history = (page: Page) => page.getByRole("list", { name: "Sign-in history" });

  test("the_tab_opens_it_and_its_list_scrolls_under_a_header_that_stays", async ({ page }) => {
    await open(page);
    await page.getByRole("link", { name: "Sign-in history" }).click();
    await expect(page).toHaveURL(/\/notifications\/sign-ins$/);
    await expect(history(page).locator("li")).toHaveCount(INBOX_SIZE);
    await expect(page.getByRole("link", { name: "Sign-in history" })).toHaveAttribute("aria-current", "page");
    const footer = await page.locator("footer").boundingBox();
    expect(footer?.y ?? 0).toBeGreaterThanOrEqual(800);
    const box = history(page).locator("xpath=..");
    const header = box.locator("> div").first();
    const before = await header.boundingBox();
    await box.evaluate((node) => node.scrollBy(0, 200));
    expect(await box.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect((await header.boundingBox())?.y).toBeCloseTo(before?.y ?? 0, 0);
    // With script the rows say how long ago, and the times are the device's own.
    await expect(history(page).locator("li").first()).toContainText(/ago|just now/);
  });

  test("delete_selected_waits_for_a_tick", async ({ page }) => {
    expect((await openPage(page, HISTORY))?.status()).toBe(200);
    const button = page.getByRole("button", { name: "Delete selected" });
    await expect(page.getByRole("checkbox", { name: "Select all" })).toBeVisible(); // the client has run
    await expect(button).toBeDisabled();
    await history(page).getByRole("checkbox").first().check();
    await expect(button).toBeEnabled();
    await page.getByRole("checkbox", { name: "Select all" }).check();
    await expect(history(page).getByRole("checkbox", { checked: true })).toHaveCount(INBOX_SIZE);
  });
});

test.describe("narrow window", () => {
  // At 900 pixels the list's 2/5 cuts the titles off.
  test.use({ viewport: { width: 900, height: 760 } });

  test("a_cut_off_row_is_lifted_after_a_rest_and_a_click_still_shows_it", async ({ page }) => {
    await open(page);
    const lifted = page.locator("[data-lift]");
    const row = rows(page).nth(6);
    const box = await row.boundingBox();
    if (box === null) throw new Error("no row");
    const y = box.y + box.height / 2;
    // Near the drag bar it never lifts.
    await page.mouse.move(box.x + box.width - 10, y);
    await page.waitForTimeout(700);
    await expect(lifted).toHaveCount(0);
    await page.mouse.move(box.x + box.width / 2, y);
    await expect(lifted).toBeVisible();
    const [rowWidth, liftWidth] = [box.width, (await lifted.boundingBox())?.width ?? 0];
    expect(liftWidth).toBeGreaterThan(rowWidth);
    // A wheel turn scrolls the list by that turn, once, and not the page, and drops it.
    await page.mouse.wheel(0, 120);
    await expect(lifted).toHaveCount(0);
    // A second scroll, of the list or the page, comes within a few frames when it comes.
    await page.waitForTimeout(300);
    expect(await list(page).evaluate((form) => form.scrollTop)).toBe(120);
    expect(await page.evaluate(() => (globalThis as unknown as { scrollY: number }).scrollY)).toBe(0);
    // Once lifted again, a click shows that row.
    const again = await row.boundingBox();
    if (again === null) throw new Error("no row");
    await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
    await expect(lifted).toBeVisible();
    const title = (await row.locator("[data-title]").textContent()) ?? "";
    await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
    await expect(lifted).toHaveCount(0);
    await expect(page.locator("#notification-detail-title")).toHaveText(title);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("the_detail_is_its_own_screen_and_back_returns_to_the_list", async ({ page }) => {
    expect((await openPage(page, INBOX))?.status()).toBe(200);
    await expect(page.locator("#notification-detail-title")).toBeHidden();
    const first = rows(page).first();
    const title = (await first.locator("[data-title]").textContent()) ?? "";
    await first.locator("a").click();
    await expect(page).toHaveURL(/\/notifications\?n=[0-9a-f-]{36}$/);
    await expect(page.locator("#notification-detail-title")).toHaveText(title);
    await expect(list(page)).toBeHidden();
    await page.goBack();
    await expect(list(page)).toBeVisible();
  });
});
