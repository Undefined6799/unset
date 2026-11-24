// A tab left open across a deploy (P1.21g; ADR 0069). The client is split into content-hashed pieces
// (interfaces/web/vite.config.ts), and a deploy removes the old ones, so a member who comes back to an old tab and
// clicks to a page whose piece the tab never loaded asks for a file that is gone. SvelteKit 3.2.0 answers that itself:
// when a route's import fails it fetches /_app/version.json and, if the build changed, loads the page in full instead
// (node_modules/@sveltejs/kit/src/runtime/client/client.js, load_route: "Referenced node could have been removed due to
// redeploy", updated.check, native_navigation). These tests make the browser see what it sees after a deploy, an
// unknown version and every old piece 404, and ask the impatient-member question: the member lands on a real page,
// never a blank one or a framework error. The server is the one build throughout, so the full load gets real files.
import { expect, type Page, type Response, test } from "@playwright/test";
import { openAccountMenu } from "./navbar.ts";
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
 * Opens the member's own page as a tab of an older build. A deploy renames every piece whose content changed (each name
 * carries its content's hash), so the pieces an old tab lacks are never ones the new build serves. Here the server is
 * the one build throughout, so the tab's client asks for each page's piece under a name of its own (a `?build=older`
 * query; adapter-node serves by path, so the file is the same until the deploy) and the full load after it asks for
 * the real names. Without that the test is not a deploy: WebKit never fetches again a module URL that failed in the
 * tab, even across a full load with `no-store` or after a network error, so the new page itself failed (measured on
 * Playwright 1.64.1 WebKit, P1.21g).
 */
async function openOlderTab(page: Page): Promise<void> {
  const APP = "**/_app/immutable/entry/app.*.js";
  await page.route(APP, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(/"(\.\.\/nodes\/\d+\.[\w-]+\.js)"/g, '"$1?build=older"');
    const { "content-encoding": _encoding, "content-length": _length, ...headers } = response.headers();
    await route.fulfill({ status: response.status(), headers, body });
  });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.unroute(APP);
}

/**
 * From now on the tab is on the far side of a deploy: every build file is gone until the browser next loads a
 * document, which comes from the new build; after that files and version.json are served as they are. version.json
 * names another build at once, or with `unchecked`, only once a gone file has been asked for: the deploy landed after
 * the tab last checked, so the member's click meets the missing piece first. Returns the documents the tab loads after
 * the deploy and the gone files it asked for.
 */
async function redeploy(page: Page, { unchecked = false } = {}): Promise<{ documents: string[]; gone: string[] }> {
  const documents: string[] = [];
  const gone: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documents.push(new URL(request.url()).pathname);
    }
  });
  await page.route("**/_app/version.json", (route) =>
    documents.length === 0 && (gone.length > 0 || !unchecked)
      ? route.fulfill({ status: 200, contentType: "application/json", body: '{"version":"a-later-build"}' })
      : route.fallback(),
  );
  await page.route("**/_app/immutable/**", (route) => {
    if (documents.length > 0) return route.fallback();
    const url = new URL(route.request().url());
    gone.push(`${url.pathname}${url.search}`);
    return route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
  });
  return { documents, gone };
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

/**
 * Presses a link to each path in turn the way clicks do, in one go and without waiting for anything; SvelteKit's
 * router takes them. One go, because a press that loads its page in full can unload the document before a later
 * press from the test arrives, which no member's second click can outrun either.
 */
async function press(page: Page, ...paths: string[]): Promise<void> {
  await page.evaluate((hrefs) => {
    // No DOM lib in this project (observe.ts does the same): the page's document, typed as far as this needs.
    type Link = { href: string; click: () => void; remove: () => void };
    const { document } = globalThis as unknown as {
      document: { createElement: (tag: "a") => Link; body: { append: (node: Link) => void } };
    };
    for (const href of hrefs) {
      const link = document.createElement("a");
      link.href = href;
      document.body.append(link);
      link.click();
      link.remove();
    }
  }, paths);
}

test("a_click_in_a_tab_older_than_the_deploy_loads_the_page_in_full", async ({ page }) => {
  await openOlderTab(page);
  const seen = trouble(page);
  const { documents, gone } = await redeploy(page, { unchecked: true });
  await (await openAccountMenu(page)).getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
  await expect(page.locator("main h1").first()).toContainText("Profile");
  await expect(page.locator("body")).not.toContainText(/Internal Error|Something went wrong|Not Found/i);
  // The page arrived as a full load, and it works: SvelteKit took over again, so the next click is a client one.
  expect(documents).toEqual(["/settings/profile"]);
  // It got there by the path under test: the click asked for the old build's piece of the page, which was gone.
  expect(gone.some((file) => file.endsWith("?build=older"))).toBe(true);
  await page.waitForLoadState("networkidle");
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Account" }).click();
  await expect(page.locator("main h1").first()).toContainText("Account");
  expect(documents).toEqual(["/settings/profile"]);
  expect(seen).toEqual([]);
});

// The member comes back to the old tab: SvelteKit checks version.json when a tab regains focus, so it knows of the
// deploy before the first click, and the root layout's beforeNavigate loads each pressed page in full at once
// (interfaces/web/src/routes/+layout.svelte). Without that hook, kit 3.2.0's load_route sends a superseded
// navigation's full load after the newer one's when its import fails, so from a third to most of the runs ended on
// the first page pressed (2 of 6 and 8 of 10, measured on this test, P1.21g); with it the last press wins.
test("pressing_two_pages_fast_in_an_old_tab_ends_on_the_last_one", async ({ page }) => {
  await openOlderTab(page);
  const seen = trouble(page);
  const { documents } = await redeploy(page);
  // Kit marks the tab updated only once it has read version.json's body, so wait for the whole response, not headers.
  const checked = page.waitForEvent(
    "requestfinished",
    (request) => new URL(request.url()).pathname === "/_app/version.json",
  );
  // No DOM lib in this project (observe.ts does the same): the window, typed as far as this needs.
  await page.evaluate(() =>
    (globalThis as unknown as { dispatchEvent: (event: Event) => boolean }).dispatchEvent(new Event("focus")),
  );
  await checked;
  await press(page, "/settings/profile", "/settings/account");
  await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/account`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main h1").first()).toContainText("Account");
  await expect(page.locator("body")).not.toContainText(/Internal Error|Something went wrong|Not Found/i);
  expect(documents.at(-1)).toBe("/settings/account");
  expect(seen).toEqual([]);
});
