// An impatient member (P1.20o; Alex 2026-11-19 13:01Z: "white page or crash from pressing settings and profile
// repeatedly fast, this should not happen", and 13:02Z: "these are the kind of bug we need to look for as well"). Every
// test hammers the app the way a person in a hurry does, then waits for it to settle and asks one thing: the member
// sees a real page, never a blank one, a framework error or a server error.
//
// These run against the web server alone (fixtures/servers.ts), not through the edge. On staging the edge's app_burst
// zone (deployment/edge/snippets/ratelimit.caddy; its value in deployment/edge/limits.json, appRateLimitZones) refuses
// a member past that many requests in 10 s per address: a client navigation costs one request (its __data.json), and
// SvelteKit 3.2.0 answers a refused one by fetching the root layout's data again and then loading the page in full
// (node_modules/@sveltejs/kit/src/runtime/client/client.js, load_route, load_root_error_page, native_navigation), which
// the edge refuses too, so the member lands on the edge's Too many tries page. At 20 per 10 s that wall met a member
// navigating about twice a second (measured in the P1.20o PR); P1.20r raised it to 60 (ADR 0066). These tests keep
// each burst under the zone on purpose (BURST below) so that what they judge is the app.
import { expect, type Page, type Response, test } from "@playwright/test";
import { accountButton, accountMenu, openAccountMenu } from "./navbar.ts";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture, TEST_ORIGIN } from "./pages.ts";

/** Under app_burst's events per 10 s (deployment/edge/limits.json), so the edge allows each burst these tests make. */
const BURST = 18;

const fixture = (path: string, route = path): PageFixture => ({
  path,
  route,
  group: "app",
  expectJs: true,
  member: "account",
});
const OWN_PAGE = fixture(`/${ACCOUNT.did}`, "/:did");
const SETTINGS = fixture("/settings/profile");
const PRIVACY = fixture("/settings/privacy"); // Search and AI lives here since P1.21y

/** The member's main pages and the heading each shows once it has really arrived. */
const PAGES = [
  { path: `/${ACCOUNT.did}`, heading: "Member One" },
  { path: "/settings/profile", heading: "Profile" },
  { path: "/settings/account", heading: "Account" },
  { path: "/legal/terms", heading: "Terms" },
] as const;

/** What went wrong while a test ran: script errors, and responses that are the server's fault or a refusal. */
function trouble(page: Page): string[] {
  const seen: string[] = [];
  page.on("pageerror", (error) => seen.push(`pageerror ${error.message}`));
  page.on("response", (response: Response) => {
    if (response.status() >= 500 || response.status() === 429) {
      seen.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  return seen;
}

/** Presses a link to `path` the way a click does, without waiting for anything; SvelteKit's router takes it. */
async function press(page: Page, path: string): Promise<void> {
  await page.evaluate((href) => {
    // No DOM lib in this project (observe.ts does the same): the page's document, typed as far as this needs.
    type Link = { href: string; click: () => void; remove: () => void };
    const { document } = globalThis as unknown as {
      document: { createElement: (tag: "a") => Link; body: { append: (node: Link) => void } };
    };
    const link = document.createElement("a");
    link.href = href;
    document.body.append(link);
    link.click();
    link.remove();
  }, path);
}

/** The member sees `path`'s real page: its URL, its heading, and none of the error page's words. */
async function landedOn(page: Page, path: string, heading?: string): Promise<void> {
  const target = heading === undefined ? PAGES.find((candidate) => candidate.path === path) : { heading };
  await expect(page).toHaveURL(new RegExp(`^${TEST_ORIGIN}${path}(\\?saved)?(#[a-z-]+)?$`));
  await expect(page.locator("main h1").first()).toContainText(target?.heading ?? "");
  await expect(page.locator("body")).not.toContainText(/Internal Error|Something went wrong|Not Found/i);
}

for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "phone", size: { width: 375, height: 800 } },
] as const) {
  test.describe(viewport.name, () => {
    test.use({ viewport: viewport.size });

    test("pressing_profile_and_settings_fast_ends_on_the_last_page_pressed", async ({ page }) => {
      expect((await openPage(page, SETTINGS))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      const seen = trouble(page);
      let last = "";
      for (let i = 0; i < BURST; i += 1) {
        last = i % 2 === 0 ? OWN_PAGE.path : SETTINGS.path;
        await press(page, last);
        await page.waitForTimeout(40);
      }
      await landedOn(page, last);
      expect(seen).toEqual([]);
    });

    test("pressing_every_pair_of_main_pages_fast_ends_on_the_last_page_pressed", async ({ page }) => {
      expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      const seen = trouble(page);
      const order = PAGES.flatMap((from) =>
        PAGES.filter((to) => to !== from).map((to) => [from.path, to.path] as const),
      );
      // Twelve ordered pairs, each pressed back to back, BURST presses before the page is judged.
      for (let start = 0; start < order.length; start += BURST / 2) {
        let last: string = OWN_PAGE.path;
        for (const [from, to] of order.slice(start, start + BURST / 2)) {
          await press(page, from);
          await press(page, to);
          last = to;
        }
        await landedOn(page, last);
      }
      expect(seen).toEqual([]);
    });

    test("back_and_forward_during_a_load_ends_on_a_real_page", async ({ page }) => {
      expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      // Three client navigations by real clicks (a history entry a script pushes without a click is one Chromium's
      // Back may skip), so Back and Forward stay inside SvelteKit's router.
      await (await openAccountMenu(page)).getByRole("menuitem", { name: "Settings" }).click();
      await expect(page).toHaveURL(`${TEST_ORIGIN}${SETTINGS.path}`);
      await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Account" }).click();
      await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/account`);
      await page.locator("footer").getByRole("link", { name: "Terms" }).click();
      await expect(page).toHaveURL(`${TEST_ORIGIN}/legal/terms`);
      const seen = trouble(page);
      // Back and Forward as the browser's own buttons, each pressed before the last one's page has loaded.
      for (let i = 0; i < 6; i += 1) {
        await page.goBack({ waitUntil: "commit" });
        await page.goForward({ waitUntil: "commit" });
      }
      await page.goBack({ waitUntil: "commit" });
      await page.goBack({ waitUntil: "commit" });
      await page.waitForLoadState("networkidle");
      await landedOn(page, SETTINGS.path);
      expect(seen).toEqual([]);
    });

    test("opening_the_account_menu_while_a_page_loads_leaves_a_working_page", async ({ page }) => {
      expect((await openPage(page, SETTINGS))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      const seen = trouble(page);
      const opener = accountButton(page);
      await press(page, OWN_PAGE.path);
      await opener.click();
      await landedOn(page, OWN_PAGE.path);
      // The menu still opens and still takes the member somewhere after the race.
      if (!(await accountMenu(page).isVisible())) await opener.click();
      await accountMenu(page).getByRole("menuitem", { name: "Settings" }).click();
      await landedOn(page, SETTINGS.path);
      expect(seen).toEqual([]);
    });
  });
}

test("saving_the_profile_three_times_fast_says_saved_once_and_stays", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const seen = trouble(page);
  const save = page.getByRole("button", { name: "Save profile" });
  await save.click({ clickCount: 3, delay: 20 });
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await landedOn(page, SETTINGS.path);
  expect(seen).toEqual([]);
});

test("saving_search_and_ai_three_times_fast_lands_back_on_settings", async ({ page }) => {
  expect((await openPage(page, PRIVACY))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const seen = trouble(page);
  await page.getByRole("button", { name: "Save privacy" }).click({ clickCount: 3, delay: 20 });
  await page.waitForLoadState("networkidle");
  await landedOn(page, PRIVACY.path, "Privacy");
  expect(seen).toEqual([]);
});

test("pressing_each_theme_fast_leaves_the_last_one_chosen", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const seen = trouble(page);
  const menu = await openAccountMenu(page);
  for (const name of ["Dark", "Light", "System", "Dark"]) {
    await menu.getByRole("menuitemradio", { name }).click({ noWaitAfter: true });
  }
  await page.waitForLoadState("networkidle");
  await landedOn(page, SETTINGS.path);
  // The last press wins, in the picker now and in what the server kept (P1.20o review).
  await expect(menu.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect((await openAccountMenu(page)).getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(seen).toEqual([]);
});

test("reloading_in_the_middle_of_a_save_shows_the_page_again", async ({ page }) => {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const seen = trouble(page);
  await page.getByRole("button", { name: "Save profile" }).click({ noWaitAfter: true });
  await page.reload();
  await landedOn(page, SETTINGS.path);
  expect(seen).toEqual([]);
});

test.describe("no script", () => {
  test.use({ javaScriptEnabled: false });

  test("pressing_profile_and_settings_fast_ends_on_the_last_page_pressed", async ({ page }) => {
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    const seen = trouble(page);
    let last = "";
    for (let i = 0; i < BURST; i += 1) {
      last = i % 2 === 0 ? OWN_PAGE.path : SETTINGS.path;
      await page.goto(`${TEST_ORIGIN}${last}`, { waitUntil: "commit" });
    }
    await page.waitForLoadState("load");
    await landedOn(page, last);
    expect(seen).toEqual([]);
  });

  // With no script the save's 303 brings the member back to the form; that page says nothing of the save (a gap the
  // P1.20o PR lists, not this test's subject).
  test("saving_the_profile_three_times_fast_lands_back_on_settings", async ({ page }) => {
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    const seen = trouble(page);
    await page.getByRole("button", { name: "Save profile" }).click({ clickCount: 3, delay: 20 });
    await page.waitForLoadState("load");
    await landedOn(page, SETTINGS.path);
    expect(seen).toEqual([]);
  });

  test("saving_search_and_ai_three_times_fast_lands_back_on_settings", async ({ page }) => {
    expect((await openPage(page, PRIVACY))?.status()).toBe(200);
    const seen = trouble(page);
    await page.getByRole("button", { name: "Save privacy" }).click({ clickCount: 3, delay: 20 });
    await page.waitForLoadState("load");
    await landedOn(page, PRIVACY.path, "Privacy");
    expect(seen).toEqual([]);
  });
});
