// Staging walkthrough 2026-11-18, round two: the profile save names the field it refuses, with and without script; the
// avatar's link reads as the shape choice it is and does not underline the letter; the tab names the member; the
// README's text area stops at the lexicon's limit, so a no-script save cannot outgrow the form's body cap. P1.20s moved
// the settings form's submit handler beside its route: a save still says it saved, with and without script.
import { expect, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture } from "./pages.ts";

const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};
const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};
const TOO_LONG_HEADLINE = "x".repeat(121);

test("a_headline_that_is_too_long_is_named_under_its_field", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const headline = page.getByRole("textbox", { name: "Headline" });
  await headline.fill(TOO_LONG_HEADLINE);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(headline).toBeFocused();
  await expect(headline).toHaveAttribute("aria-invalid", "true");
  await expect(headline).toHaveAccessibleDescription(/up to 120 characters\..*too long: up to 120 characters/);
  await expect(headline).toHaveValue(TOO_LONG_HEADLINE);
});

test("a_profile_save_stays_on_settings_and_says_it_saved", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const headline = page.getByRole("textbox", { name: "Headline" });
  const typed = await headline.inputValue();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/profile\?saved$/);
  await expect(headline).toHaveValue(typed);
});

test("the_avatar_link_names_the_shape_and_leaves_the_letter_plain", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const avatar = page.getByRole("link", { name: "Change picture shape" });
  await expect(avatar).toHaveCSS("text-decoration-line", "none");
});

test("the_tab_names_the_member_never_handle_invalid", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const name = await page.getByRole("heading", { level: 1 }).textContent();
  const title = await page.title();
  expect(title).not.toBe("handle.invalid");
  expect([name?.trim(), "Your page"]).toContain(title);
});

test.describe("no script", () => {
  test.use({ javaScriptEnabled: false });

  test("a_refused_profile_save_names_the_field_and_the_way_back", async ({ page }) => {
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    await page.getByRole("textbox", { name: "Headline" }).fill(TOO_LONG_HEADLINE);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Check Headline.")).toBeVisible();
    await expect(page.getByText(/browser's Back button/)).toBeVisible();
  });

  // P1.20o's sweep found this save silent: the 303 came back to an unchanged form, though the header above promised
  // "with and without script". It now comes back with ?saved (P1.20p), as /invite?left= does, and says it saved.
  test("a_profile_save_without_script_comes_back_to_settings_and_says_it_saved", async ({ page }) => {
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    const headline = page.getByRole("textbox", { name: "Headline" });
    const typed = await headline.inputValue();
    await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toHaveCount(0);
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/profile"));
    await page.getByRole("button", { name: "Save profile" }).click();
    expect((await saved).status()).toBe(303);
    await expect(page).toHaveURL(/\/settings\/profile\?saved$/);
    await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
    await expect(headline).toHaveValue(typed);
  });

  test("the_readme_text_area_stops_at_the_editor_limit", async ({ page }) => {
    expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
    const panel = page.locator("#card-editor");
    await page.getByRole("link", { name: "Add card" }).click();
    await panel.getByRole("link", { name: /^Text/ }).click();
    await expect(panel.getByRole("textbox", { name: "Text" })).toHaveAttribute("maxlength", "10000");
  });
});

// Alex 2026-11-18 12:24Z: the card's layout and width are chosen by icon, each with its word, as native radios.
test("the_layout_and_width_choices_show_an_icon_with_their_word", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Add card" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Links/ })
    .click();
  const editor = page.getByRole("dialog");
  for (const name of ["Full width", "Half width", "List", "Grid", "Carousel"]) {
    const radio = editor.getByRole("radio", { name, exact: true });
    await expect(radio).toHaveAttribute("type", "radio");
    const tile = editor.locator("label").filter({ has: page.getByRole("radio", { name, exact: true }) });
    await expect(tile.locator("svg")).toHaveCount(1);
  }
  await editor.getByText("Carousel", { exact: true }).click();
  await expect(editor.getByRole("radio", { name: "Carousel", exact: true })).toBeChecked();
});
