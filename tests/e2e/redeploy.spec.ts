// A tab left open across a deploy (P1.21g; ADR 0069). The client is split into content-hashed pieces
// (interfaces/web/vite.config.ts), and a deploy removes the old ones, so a member who comes back to an old tab and
// clicks to a page whose piece the tab never loaded asks for a file that is gone. SvelteKit 3.2.0 answers that itself:
// when a route's import fails it fetches /_app/version.json and, if the build changed, loads the page in full instead
// (node_modules/@sveltejs/kit/src/runtime/client/client.js, load_route: "Referenced node could have been removed due to
// redeploy", updated.check, native_navigation). These tests make the browser see what it sees after a deploy, an
// unknown version and every old piece 404, and ask the impatient-member question: the member lands on a real page,
// never a blank one or a framework error. The server is the one build throughout, so the full load gets real files.
import { expect, type Page, type Response, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture, TEST_ORIGIN } from "./pages.ts";

const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};

/**
 * From now on the tab is on the far side of a deploy: version.json names another build, and every build file is gone
 * until the browser next loads a document. Returns the documents the tab loads after that.
 */
async function redeploy(page: Page): Promise<string[]> {
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documents.push(new URL(request.url()).pathname);
    }
  });
  await page.route("**/_app/version.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"version":"a-later-build"}' }),
  );
  await page.route("**/_app/immutable/**", (route) =>
    documents.length === 0
      ? route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" })
      : route.fallback(),
  );
  return documents;
}

/** Script errors, and responses that are the server's fault or a refusal; the gone files' 404s are the deploy's. */
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

test("a_click_in_a_tab_older_than_the_deploy_loads_the_page_in_full", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const seen = trouble(page);
  const documents = await redeploy(page);
  await page.locator('header button[popovertarget="account-menu"]').click();
  await page.locator("#account-menu").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
  await expect(page.locator("main h1").first()).toContainText("Profile");
  await expect(page.locator("body")).not.toContainText(/Internal Error|Something went wrong|Not Found/i);
  // The page arrived as a full load, and it works: SvelteKit took over again, so the next click is a client one.
  expect(documents).toEqual(["/settings/profile"]);
  await page.waitForLoadState("networkidle");
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Account" }).click();
  await expect(page.locator("main h1").first()).toContainText("Account");
  expect(documents).toEqual(["/settings/profile"]);
  expect(seen).toEqual([]);
});

test("pressing_two_pages_fast_in_an_old_tab_ends_on_the_last_one", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const seen = trouble(page);
  const documents = await redeploy(page);
  // The second press lands while the first one's failed import and version check are still in flight.
  await press(page, "/settings/profile");
  await press(page, "/settings/account");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/account`);
  await expect(page.locator("main h1").first()).toContainText("Account");
  await expect(page.locator("body")).not.toContainText(/Internal Error|Something went wrong|Not Found/i);
  expect(documents.at(-1)).toBe("/settings/account");
  expect(seen).toEqual([]);
});
