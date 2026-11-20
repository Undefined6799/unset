// P1.21y: Settings › Privacy, the Search and AI form (ADR 0062) and its search result preview. With no script the
// "Advanced" disclosure still opens and a save comes back saying so, with the preview showing what was saved; where
// the client runs the preview follows the fields as the member types. A double press of Save lands once, on the saved
// page. Each test puts the member's choices back to all off, as the other specs expect them.
import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import type { PageFixture } from "./pages.ts";

const PRIVACY: PageFixture = {
  path: "/settings/privacy",
  route: "/settings/privacy",
  group: "app",
  expectJs: true,
  member: "account",
};

const section = (page: Page) => page.locator("#search-and-ai");
const preview = (page: Page) => page.locator("[data-search-preview]");

/** Clears both fields and both switches and saves, as a member would. */
async function resetChoices(page: Page) {
  expect((await openPage(page, PRIVACY))?.status()).toBe(200);
  const form = section(page);
  const advanced = form.locator("details");
  if ((await advanced.getAttribute("open")) === null) await advanced.locator("summary").click();
  await form.getByLabel("Search title").fill("");
  await form.getByLabel("Search description").fill("");
  await form.getByLabel("Search engines may list my page").uncheck();
  await form.getByLabel("AI search may show my page").uncheck();
  await form.getByRole("button", { name: "Save search and AI" }).click();
  await expect(page).toHaveURL(/\/settings\/privacy\?saved#search-and-ai$/);
}

test.describe("javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("advanced_opens_and_a_save_shows_in_the_preview", async ({ page }) => {
    expect((await openPage(page, PRIVACY))?.status()).toBe(200);
    const form = section(page);
    await expect(
      page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Privacy" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(form.getByLabel("Search title")).toBeHidden();
    await expect(preview(page)).toBeHidden(); // inside Advanced (Alex, 2026-11-20 19:21Z)
    await form.locator("summary").click();
    await expect(preview(page)).toBeVisible();
    await form.getByLabel("Search title").fill("Member One, maker");
    await form.getByLabel("Search engines may list my page").check();
    try {
      await form.getByRole("button", { name: "Save search and AI" }).click();
      await expect(page).toHaveURL(/\/settings\/privacy\?saved#search-and-ai$/);
      await expect(form).toContainText("Search and AI saved.");
      await expect(preview(page).locator("[data-preview-title]")).toHaveText("Member One, maker");
      await expect(page.locator("[data-preview-unlisted]")).toHaveCount(0);
    } finally {
      await resetChoices(page);
    }
  });
});

test.describe("javascript on", () => {
  test("the_preview_follows_the_fields_as_the_member_types", async ({ page }) => {
    expect((await openPage(page, PRIVACY))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const form = section(page);
    const title = preview(page).locator("[data-preview-title]");
    const before = await title.textContent();
    await form.locator("summary").click();
    await form.getByLabel("Search title").fill("A title typed just now");
    await expect(title).toHaveText("A title typed just now");
    await form.getByLabel("Search description").fill("And a description.");
    await expect(preview(page).locator("[data-preview-description]")).toHaveText("And a description.");
    // Emptied, the preview falls back to what the page shows without an override.
    await form.getByLabel("Search title").fill("");
    await expect(title).toHaveText(before ?? "");
    await expect(page.locator("[data-preview-unlisted]")).toHaveCount(1);
    await form.getByLabel("Search engines may list my page").check();
    await expect(page.locator("[data-preview-unlisted]")).toHaveCount(0);
  });

  test("pressing_save_twice_fast_lands_once_on_the_saved_page", async ({ page }) => {
    expect((await openPage(page, PRIVACY))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const failures: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 500 || response.status() === 429)
        failures.push(`${response.status()} ${response.url()}`);
    });
    const save = section(page).getByRole("button", { name: "Save search and AI" });
    await save.click({ noWaitAfter: true });
    await save.click({ noWaitAfter: true }).catch(() => undefined); // the page may already be leaving
    await expect(page).toHaveURL(/\/settings\/privacy\?saved#search-and-ai$/);
    await expect(section(page)).toContainText("Search and AI saved.");
    expect(failures).toEqual([]);
  });
});
