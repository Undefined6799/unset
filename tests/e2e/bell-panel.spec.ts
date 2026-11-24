// Book P1.22g (ADR 0116 points 8 and 9): the bell opens its panel wherever SvelteKit's client runs, the error page
// included. The server draws the bell as a plain link to /notifications on every page; once the client is ready the
// bell is the panel's button, the panel lists the entries the page's data holds, with times in the device's zone, and
// opening it posts the mark for what it showed (ADR 0085). Until the client is ready, and in a browser with no script
// (nojs.spec.ts), a press follows the link, whose visit marks the list. tests/integration/web/app/notifications.test.ts
// holds what the server draws and sends, and what the mark does.
import { expect, type Page, test } from "@playwright/test";
import { BELL_PANEL, stockPanel } from "./navbar.ts";
import { openPage, pageNoise, watch } from "./observe.ts";
import { BELL_SIZE, INDEXED, type PageFixture, PROD_ORIGIN } from "./pages.ts";
import { phone } from "./phone.ts";

/** Each kind of page a signed-in member meets the bell on, at its address on the test server. */
const PLACES = [
  { name: "home", path: "/", status: 200 },
  { name: "a_legal_page", path: "/legal/terms", status: 200 },
  { name: "the_invite_request", path: "/request-invite", status: 200 },
  { name: "an_address_no_route_matches", path: "/no/such/page", status: 404 },
  { name: "a_load_that_failed", path: `/@did:plc:${"z".repeat(24)}`, status: 404 },
  { name: "an_app_page", path: "/settings/profile", status: 200 },
] as const;

const as = (member: PageFixture["member"], path: string): PageFixture => ({
  path,
  route: path,
  group: "public",
  expectJs: true,
  ...(member === undefined ? {} : { member }),
});

// With script the bell's panel is the stock Popover, a dialog named by its title (book P1.22m, navbar-panels.spec.ts).
const panel = (page: Page) => stockPanel(page, BELL_PANEL);
const rows = (page: Page) => panel(page).locator('a[href^="/notifications?n="]');

for (const place of PLACES) {
  // The "bell" member has BELL_SIZE entries nobody has seen, and they must stay unseen for every test here and in
  // notifications.spec.ts. So the browser is offline when the bell opens: the mark it posts fails, nothing is stored,
  // and the badge comes back (no request is intercepted, rule TE-2: Playwright BrowserContext.setOffline).
  test(`the_bell_opens_its_panel_and_posts_the_mark_on_${place.name}`, async ({ page, context }) => {
    const watched = watch(page);
    expect((await openPage(page, as("bell", place.path)))?.status()).toBe(place.status);
    // The client took the server's link over: the bell is the panel's button, and no link to the page is left in
    // the header.
    const bell = page.locator("header").getByRole("button", { name: `Notifications, ${BELL_SIZE} waiting` });
    await expect(bell).toBeVisible();
    await expect(page.locator('header a[href="/notifications"]')).toHaveCount(0);
    await expect(panel(page)).toBeHidden();

    await context.setOffline(true);
    const failed = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/notifications?/seen"));
    await bell.click();
    expect((await failed).method()).toBe("POST");
    await expect(panel(page)).toBeVisible();
    // Every entry the page was sent is a row, each a link to its own detail, and its time is the device's, not UTC.
    await expect(rows(page)).toHaveCount(BELL_SIZE);
    for (const time of await panel(page).locator("time").all()) await expect(time).not.toContainText("UTC");
    await expect(panel(page).getByRole("link", { name: "View all notifications" })).toHaveAttribute(
      "href",
      "/notifications",
    );
    // The mark did not arrive, so the count is back.
    await expect(bell).toBeVisible();
    await context.setOffline(false);
    expect((await pageNoise(page, watched)).csp).toEqual([]);
    expect(watched.pageErrors).toEqual([]);
  });
}

// A visitor has no notifications: the panel says to sign in, as it does on an app page a visitor reads, and nothing
// is posted. On the production server, where the public profile is.
for (const path of ["/", `/@${INDEXED.did}`, "/no/such/page"]) {
  test(`a_visitor_s_bell_opens_a_panel_that_says_to_sign_in ${path}`, async ({ page }) => {
    const watched = watch(page);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    await page.goto(`${PROD_ORIGIN}${path}`);
    await page.locator("header").getByRole("button", { name: "Notifications", exact: true }).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText("Sign in to see your notifications.");
    await expect(rows(page)).toHaveCount(0);
    expect(posts).toEqual([]);
    expect((await pageNoise(page, watched)).csp).toEqual([]);
    expect(watched.pageErrors).toEqual([]);
  });
}

// ADR 0116 point 9: until the client is ready a press does the plain thing, and it is never lost. With the script
// files refused the client never is ready, so the bell stays the server's link and takes the member to the page.
test("until_the_client_is_ready_the_bell_is_the_link_to_the_page", async ({ page }) => {
  await page.route("**/*", (route) => (route.request().resourceType() === "script" ? route.abort() : route.continue()));
  expect((await openPage(page, as("account", "/")))?.status()).toBe(200);
  const bell = page.locator("header").getByRole("link", { name: "Notifications", exact: true });
  await expect(bell).toHaveAttribute("href", "/notifications");
  await expect(panel(page)).toHaveCount(0);
  await bell.click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.locator("main")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone({ width: 375, height: 800 }));

  // On a phone the bell is a row of More actions. The "inbox" member's list is read and never counted here.
  test("more_actions_opens_the_bell_s_panel_on_home", async ({ page }) => {
    expect((await openPage(page, as("inbox", "/")))?.status()).toBe(200);
    const row = page.locator('#actions-menu button[popovertarget="notifications-menu"]');
    await expect(row).toHaveCount(1); // the client has taken the server's link over
    await expect(page.locator('#actions-menu a[href="/notifications"]')).toHaveCount(0);
    await page.locator('header button[popovertarget="actions-menu"]').tap();
    await row.tap();
    // More actions is still a native popover, and its row opens the native panel (book P1.22m part 4 moves both).
    const native = page.locator("section#notifications-menu");
    await expect(native).toBeVisible();
    await expect(native.locator('a[href^="/notifications?n="]').first()).toBeVisible();
  });
});
