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

test("the_drawer_closes_after_a_client_navigation", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.locator('header button[popovertarget="core-menu"]').click();
  await page.locator("#core-menu").getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/legal/terms`);
  await expect(page.locator("#core-menu")).toBeHidden();
});

test("me_from_the_home_page_reaches_the_member_page", async ({ page }) => {
  const watched = watch(page);
  expect((await openPage(page, HOME_SIGNED_IN))?.status()).toBe(200);
  await page.locator("header").getByRole("link", { name: "Profile" }).click();
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
