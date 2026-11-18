// Links between pages with SvelteKit's client running (P1.20k). The client router knows only page routes, so a link to
// a +server.ts path must not be taken for a page with a parameter: on staging, Continue on the confirm-email page (/me,
// a 303 to the member's /<DID>) was matched to /[did] with did "me" and showed not found, and its error page offered
// Sign in to a member signed in (2026-11-18).
import { expect, test } from "@playwright/test";
import { openPage, watch } from "./observe.ts";
import { ACCOUNT, type PageFixture, TEST_ORIGIN } from "./pages.ts";

const HOME_SIGNED_IN: PageFixture = { path: "/", route: "/", group: "public", expectJs: false, member: "account" };
const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};

const CONFIRMED: PageFixture = {
  path: "/verify-email",
  route: "/verify-email",
  group: "app",
  expectJs: true,
  member: "account",
};

test("continue_after_a_confirmed_email_reaches_the_member_page", async ({ page }) => {
  expect((await openPage(page, CONFIRMED))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.locator("main").getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}`);
  await expect(page.locator("h1")).not.toContainText("does not exist");
});

// Gap 4 of the P1.20k review: a client navigation keeps the layout, so a menu closes itself, as Hono's drawer did.
test("the_account_menu_profile_link_reaches_the_member_page_and_closes", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.locator('header button[popovertarget="account-menu"]').click();
  await page.locator("#account-menu").getByRole("link", { name: "Your profile" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}`);
  await expect(page.locator("#account-menu")).toBeHidden();
});

test("the_create_menu_closes_after_a_client_navigation", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.locator('header button[popovertarget="create-menu"]').click();
  await page.locator("#create-menu").getByRole("link", { name: "Add a profile card" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}#add-card`);
  await expect(page.locator("#create-menu")).toBeHidden();
});

// Alex, 2026-11-18 05:02Z: a signed-in member reading a legal page sees the same header, signed in.
test("a_legal_page_shows_the_member_signed_in", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.locator("footer").getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/legal/terms`);
  await expect(page.locator('header button[popovertarget="account-menu"]')).toBeVisible();
  await expect(page.locator("header").getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

// Outside review of f5cab2f, finding 3: from one settings page to the other the settings layout stays too, and the
// account menu that took the visitor there is closed on arrival, on a phone as on a desktop.
test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("the_account_menu_closes_after_settings_to_settings_on_a_phone", async ({ page }) => {
    const account: PageFixture = { ...SETTINGS, path: "/settings/account", route: "/settings/account" };
    expect((await openPage(page, account))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    await page.locator('header button[popovertarget="account-menu"]').click();
    const drawer = page.locator("#account-menu");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
    await expect(drawer).toBeHidden();
  });
});

// P1.20k: home reads the member's session, so its header has their account menu, not Sign in.
test("your_profile_from_the_home_page_reaches_the_member_page", async ({ page }) => {
  const watched = watch(page);
  expect((await openPage(page, HOME_SIGNED_IN))?.status()).toBe(200);
  await page.locator('header button[popovertarget="account-menu"]').click();
  await page.locator("#account-menu").getByRole("link", { name: "Your profile" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}`);
  expect(watched.pageErrors).toEqual([]);
});

test("a_client_side_not_found_offers_no_sign_in_to_a_member", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  // Another member's page reads as missing (SE-2); the member is still signed in, so the shell offers no Sign in.
  await page.evaluate(
    (path) => {
      const link = (globalThis as unknown as { document: DocumentLike }).document.createElement("a");
      link.href = path;
      (globalThis as unknown as { document: DocumentLike }).document.body.append(link);
      link.click();
    },
    `/did:plc:${"z".repeat(24)}`,
  );
  await expect(page.locator("h1")).toContainText("That page does not exist.");
  await expect(page.locator('a[href^="/login"]')).toHaveCount(0);
});

type DocumentLike = {
  createElement: (tag: string) => { href: string; click: () => void };
  body: { append: (node: object) => void };
};

// The account menu's theme picker (P2.13e, Alex 2026-10-23 02:15Z): with the client running a choice is saved in the
// background and applied in place, so the menu stays open; the next page the server renders has it from the cookie.
test("the_account_menu_theme_picker_saves_in_place", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.locator('header button[popovertarget="account-menu"]').click();
  const drawer = page.locator("#account-menu");
  const light = drawer.getByRole("button", { name: "Light" });
  await expect(light).toHaveAttribute("aria-pressed", "false");
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/prefs/theme"));
  await light.click();
  await saved;
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(drawer).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator('header button[popovertarget="account-menu"]').click();
  await drawer.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});
