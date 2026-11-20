// P1.21y: Settings › Privacy, the Search and AI form (ADR 0062) and its search result preview. With no script the
// "Advanced" disclosure still opens and a save comes back saying so, with the preview showing what was saved; where
// the client runs the preview follows the fields as the member types. A double press of Save lands once, on the saved
// page. Each test puts the member's choices back to all off, as the other specs expect them. Who sees the page (ADR
// 0078, P1.22a) leads the page: each choice's help opens with no script, and a page that is not public leaves the Search
// and AI form out; each test that changes it puts it back to Public.
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
  await page.getByRole("button", { name: "Save privacy" }).click();
  await expect(page).toHaveURL(/\/settings\/privacy\?saved#privacy$/);
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
      await page.getByRole("button", { name: "Save privacy" }).click();
      await expect(page).toHaveURL(/\/settings\/privacy\?saved#privacy$/);
      await expect(page.locator("#privacy")).toContainText("Privacy saved.");
      await expect(preview(page).locator("[data-preview-title]")).toHaveText("Member One, maker");
      await expect(page.locator("[data-preview-unlisted]")).toHaveCount(0);
    } finally {
      await resetChoices(page);
    }
  });
});

const visibility = (page: Page) => page.locator("#privacy");

test.describe("page visibility, javascript off", () => {
  test.use({ javaScriptEnabled: false });

  test("help_opens_and_closes_by_keyboard_with_no_script", async ({ page }) => {
    expect((await openPage(page, PRIVACY))?.status()).toBe(200);
    const help = page.locator('[data-visibility-help="ownerOnly"]');
    await expect(help).toBeHidden();
    await visibility(page).getByRole("button", { name: 'What "Only me" means' }).focus();
    await page.keyboard.press("Enter");
    await expect(help).toBeVisible();
    await expect(help).toContainText("Other people, signed in or not, see only your name and handle");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
  });

  test("search_and_ai_shows_only_under_public_and_waits_while_only_me", async ({ page }) => {
    expect((await openPage(page, PRIVACY))?.status()).toBe(200);
    const form = visibility(page);
    await expect(form.getByRole("radio", { name: "Public" })).toBeChecked();
    await expect(section(page)).toBeVisible();
    // With no script, ticking another choice hides the fields at once (CSS), before any save.
    await form.getByRole("radio", { name: "Only me" }).check();
    await expect(section(page)).toBeHidden();
    try {
      await page.getByRole("button", { name: "Save privacy" }).click();
      await expect(page).toHaveURL(/\/settings\/privacy\?saved#privacy$/);
      await expect(form).toContainText("Privacy saved.");
      await expect(form.getByRole("radio", { name: "Only me" })).toBeChecked();
      await expect(section(page)).toBeHidden();
    } finally {
      await visibility(page).getByRole("radio", { name: "Public" }).check();
      await page.getByRole("button", { name: "Save privacy" }).click();
      await expect(section(page)).toBeVisible();
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
    const save = page.getByRole("button", { name: "Save privacy" });
    await save.click({ noWaitAfter: true });
    await save.click({ noWaitAfter: true }).catch(() => undefined); // the page may already be leaving
    await expect(page).toHaveURL(/\/settings\/privacy\?saved#privacy$/);
    await expect(visibility(page)).toContainText("Privacy saved.");
    expect(failures).toEqual([]);
  });
});
