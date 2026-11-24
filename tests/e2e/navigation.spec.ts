// Links between pages with SvelteKit's client running (P1.20k). The client router knows only page routes, so a link to
// a +server.ts path must not be taken for a page with a parameter: on staging, Continue on the confirm-email page (/me,
// a 303 to the member's /<DID>) was matched to /[did] with did "me" and showed not found, and its error page offered
// Sign in to a member signed in (2026-11-18).
import { expect, test } from "@playwright/test";
import { addPageCookies, openPage, watch } from "./observe.ts";
import { ACCOUNT, type PageFixture, TEST_ORIGIN } from "./pages.ts";
import { phone } from "./phone.ts";

const HOME_SIGNED_IN: PageFixture = { path: "/", route: "/", group: "public", expectJs: true, member: "account" };
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
  // Codex review of f14b5ab: the item lands on the Add card picker in place (`?add`), which exists with or without
  // script; the old `#add-card` fragment named no element.
  await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}?add#card-editor`);
  await expect(page.locator("#create-menu")).toBeHidden();
  await expect(page.locator("#card-editor")).toBeInViewport();
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
  test.use(phone({ width: 375, height: 800 }));

  test("the_account_menu_closes_after_settings_to_settings_on_a_phone", async ({ page }) => {
    const account: PageFixture = { ...SETTINGS, path: "/settings/account", route: "/settings/account" };
    expect((await openPage(page, account))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    await page.locator('header button[popovertarget="account-menu"]').tap();
    const drawer = page.locator("#account-menu");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Settings" }).tap();
    await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
    await expect(drawer).toBeHidden();
  });

  // Outside audit of staging, 2026-11-19: More actions, then one of its panels, then Escape left More actions open
  // with focus on the page, so the next Tab went behind the menu. Focus goes back to the row that opened the panel
  // once the client runs (an app page; the public pages run no script).
  for (const name of ["Create", "Messages", "Notifications"]) {
    test(`escape_from_${name.toLowerCase()}_returns_focus_to_more_actions`, async ({ page }) => {
      expect((await openPage(page, SETTINGS))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      await page.locator('header button[popovertarget="actions-menu"]').click();
      const actions = page.locator("#actions-menu");
      const row = actions.getByRole("button", { name, exact: true });
      await row.click();
      await page.keyboard.press("Escape");
      await expect(actions).toBeVisible();
      await expect(row).toBeFocused();
    });
  }
});

// P1.20k: home reads the member's session, so its header has their account menu, not Sign in.
// Alex's staging report 2026-11-18: the home page showed the signed-out header and the light theme to a member. A
// browser that kept the visitor's copy of / must not show it after signing in (hooks.server.ts sends Vary: Cookie).
test("the_home_page_seen_as_a_visitor_shows_the_member_after_sign_in", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  expect((await page.goto(`${TEST_ORIGIN}/`))?.status()).toBe(200);
  const accountMenu = page.locator('header button[popovertarget="account-menu"]');
  await expect(accountMenu).toHaveCount(0);
  await addPageCookies(page.context(), HOME_SIGNED_IN, { kind: "cookie", theme: "dark" });
  await page.goto(`${TEST_ORIGIN}/`);
  await expect(accountMenu).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("your_profile_from_the_home_page_reaches_the_member_page", async ({ page }) => {
  const watched = watch(page);
  expect((await openPage(page, HOME_SIGNED_IN))?.status()).toBe(200);
  await page.locator('header button[popovertarget="account-menu"]').click();
  await page.locator("#account-menu").getByRole("link", { name: "Your profile" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}`);
  expect(watched.pageErrors).toEqual([]);
});

test("a_client_side_link_to_another_members_did_reaches_their_public_page", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  // Another member's DID is never their editor (SE-2): the client follows the server's 303 to the public page, which
  // for an account the index does not show is the one 404, shown with no page error.
  const watched = watch(page);
  const other = `did:plc:${"z".repeat(24)}`;
  await page.evaluate((path) => {
    const link = (globalThis as unknown as { document: DocumentLike }).document.createElement("a");
    link.href = path;
    (globalThis as unknown as { document: DocumentLike }).document.body.append(link);
    link.click();
  }, `/${other}`);
  await expect(page).toHaveURL(`${TEST_ORIGIN}/@${other}`);
  await expect(page.locator("h1")).toContainText("That page does not exist.");
  expect(watched.pageErrors).toEqual([]);
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
