// The owner's card editing with JavaScript off (staging walkthrough 2026-11-18, finding 8): Add card, Edit and Delete
// are links to the page with that editor in place, so a card is added, refused with the reason beside its field and
// what was typed, edited, moved and deleted with plain forms and links. The cards added are deleted again, so the
// member page is as the other specs expect it.
import { expect, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture } from "./pages.ts";

const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};

test.use({ javaScriptEnabled: false });

test("cards_are_added_edited_moved_and_deleted_without_javascript", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const panel = page.locator("#card-editor");

  // Add a Text card: Add card, then Text, then the editor's own Add.
  await page.getByRole("link", { name: "Add card" }).click();
  await expect(panel.getByRole("heading", { name: "Add a card" })).toBeVisible();
  await panel.getByRole("link", { name: /^Text/ }).click();
  await panel.getByRole("textbox", { name: "Text" }).fill("# Without script");
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: "Without script" })).toBeVisible();
  await expect(panel).toHaveCount(0);

  // Add links with a bad address in the second row, as a grid: refused, the panel is back with what was typed and
  // the reason beside the field; fixed, it is added.
  await page.getByRole("link", { name: "Add card" }).click();
  await panel.getByRole("link", { name: /^Links/ }).click();
  await panel.getByRole("textbox", { name: "Title" }).fill("Offline");
  await panel.getByRole("radio", { name: "Grid" }).check();
  await panel.getByRole("radio", { name: "Outlined", exact: true }).check();
  const second = panel.getByRole("group", { name: "Link 2", exact: true });
  await second.getByRole("textbox", { name: "Address" }).fill("not a url");
  await panel.getByRole("button", { name: "Add" }).click();
  const address = panel.getByRole("group", { name: "Link 2", exact: true }).getByRole("textbox", { name: "Address" });
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(address).toHaveAccessibleDescription(/http or https address/);
  await expect(address).toHaveValue("not a url");
  await expect(panel.getByRole("textbox", { name: "Title" })).toHaveValue("Offline");
  await expect(panel.getByRole("radio", { name: "Grid" })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "Outlined", exact: true })).toBeChecked();
  await address.fill("offline.example");
  await panel.getByRole("button", { name: "Add" }).click();
  const offline = page.getByRole("group", { name: "Offline card" });
  await expect(offline).toHaveCount(1);
  await expect(page.locator('[data-slot="card"]').filter({ has: offline })).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  // Edit the Text card in place.
  const readme = page.getByRole("group", { name: "Text card" });
  await readme.getByRole("link", { name: "Edit" }).click();
  await expect(panel.getByRole("textbox", { name: "Text" })).toHaveValue("# Without script");
  await panel.getByRole("textbox", { name: "Text" }).fill("# Still without script");
  await panel.getByRole("radio", { name: "Plain", exact: true }).check();
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Still without script" })).toBeVisible();
  await readme.getByRole("link", { name: "Edit" }).click();
  await expect(panel.getByRole("radio", { name: "Plain", exact: true })).toBeChecked();
  await panel.getByRole("link", { name: "Cancel" }).click();

  // Move the Text card below the links: with no script the moves are plain buttons, not the three-dot menu.
  await expect(readme.getByRole("button", { name: /^More for/ })).toHaveCount(0);
  const order = page.locator("[data-card-controls] legend");
  await expect(order).toHaveText(["Text card", "Offline card"]);
  await readme.getByRole("button", { name: "Move down" }).click();
  await expect(order).toHaveText(["Offline card", "Text card"]);
  await expect(readme.getByRole("button", { name: "Move up" })).toBeVisible();
  await expect(offline.getByRole("button", { name: "Move down" })).toBeVisible();

  // Delete both through the confirm in place; Cancel first leaves the card.
  await offline.getByRole("link", { name: "Delete" }).click();
  await panel.getByRole("link", { name: "Cancel" }).click();
  await expect(offline).toHaveCount(1);
  for (const card of [offline, readme]) {
    await card.getByRole("link", { name: "Delete" }).click();
    await panel.getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0);
  }
});

test("the_avatar_shape_is_chosen_without_javascript", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const panel = page.locator("#card-editor");
  await page.getByRole("link", { name: "Change picture shape" }).click();
  await panel.getByRole("radio", { name: "Rounded square", exact: true }).check();
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("link", { name: "Change picture shape" }).click();
  await expect(panel.getByRole("radio", { name: "Rounded square", exact: true })).toBeChecked();
  await panel.getByRole("radio", { name: "Round", exact: true }).check();
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel).toHaveCount(0);
});

// Alex 2026-11-18: the profile carries no Sign out and no link to the sign-in server; with no script, signing out is
// still in the account menu (a native popover).
test("sign_out_is_in_the_account_menu_not_on_the_profile", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const main = page.locator("main");
  await expect(main.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(main.locator('form[action="/logout"]')).toHaveCount(0);
  await expect(main.getByRole("link", { name: /sign-in server|Your account on/ })).toHaveCount(0);
  await page.locator('header button[popovertarget="account-menu"]').click();
  await expect(page.locator("#account-menu").getByRole("button", { name: "Sign out" })).toBeVisible();
});
