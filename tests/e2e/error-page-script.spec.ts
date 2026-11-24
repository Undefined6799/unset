// Book P1.22k (ADR 0116): the error page runs SvelteKit's client like every other page, under the app group's script
// policy, for an address no route matches and for a load that failed. Anyone can send anyone such an address, so what
// the address holds must stay text: with script on nothing of it runs and the policy reports no violation; the one
// 404 (rule SE-2) is the same page and the same requests when the client draws it after a click; and the page is the
// server's whole page when its script files are refused or its client fails while starting (nojs.spec.ts reads it with
// script off). tests/integration/web holds the same page's header by value and the bytes of its start-up script
// (every-answer.test.ts, public/public-pages.test.ts, public/public-profile.test.ts).
import { expect, type Page, type Request, type Response, test } from "@playwright/test";
import { openAccountMenu } from "./navbar.ts";
import { expectOnlyText, openPage, pageNoise, type Watched, watch } from "./observe.ts";
import { HIDDEN, INDEXED, type PageFixture, PROD_ORIGIN, TEST_ORIGIN } from "./pages.ts";

const NOT_FOUND = "That page does not exist.";
const MISSING = `did:plc:${"z".repeat(24)}`;

/**
 * Addresses nobody serves, each holding text that would set `globalThis.ran` if a browser ever read it as markup, as
 * script or as a link: a closed script element, an open comment, a quote that ends an attribute, the two line
 * separators JavaScript once ended a string at (U+2028, U+2029), a `javascript:` way back in the two query values the
 * shell's forms and links carry (`next`, `return`), a script element in the query, and a script element where a
 * profile's handle goes (a load that fails, not an unmatched path).
 */
const HOSTILE_ADDRESSES = [
  "/%3C%2Fscript%3E%3Cscript%3EglobalThis.ran=1%3C%2Fscript%3E",
  "/%3C!--%3Cscript%3EglobalThis.ran=1%3C%2Fscript%3E",
  "/%22%27%3E%3Cimg%20src=x%20onerror=%22globalThis.ran=1%22%3E",
  "/a%E2%80%A8globalThis.ran=1%E2%80%A9",
  "/nope?next=javascript:globalThis.ran=1&return=javascript:globalThis.ran=1",
  "/nope?%3C/script%3E%3Cscript%3EglobalThis.ran=1%3C/script%3E",
  "/@%3C%2Fscript%3E%3Cscript%3EglobalThis.ran=1%3C%2Fscript%3E",
] as const;

/**
 * What the page said that it should not have. A browser notes the document's own 404 in its console (Chromium:
 * "Failed to load resource: the server responded with a status of 404"); that line names the page itself and is the
 * answer under test, so it alone is set aside.
 */
async function noiseOf(page: Page, watched: Watched): Promise<string[]> {
  const noise = await pageNoise(page, watched);
  const own = (text: string) => /status of 404/.test(text) && text.endsWith(` ${page.url()}`);
  return [...noise.csp, ...noise.consoleErrors.filter((text) => !own(text)), ...watched.pageErrors];
}

/** Follows a link to `path` as a click does: SvelteKit's client takes it when it runs, the browser when it does not. */
async function click(page: Page, path: string): Promise<void> {
  await page.evaluate((href) => {
    const doc = (globalThis as unknown as { document: DocumentLike }).document;
    const link = doc.createElement("a");
    link.href = href;
    doc.body.append(link);
    link.click();
  }, path);
}

for (const address of HOSTILE_ADDRESSES) {
  test(`a_hostile_address_runs_nothing_with_script_on ${address}`, async ({ page }) => {
    const watched = watch(page);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const response = await page.goto(`${PROD_ORIGIN}${address}`);
    expect(response?.status()).toBe(404);
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain(`script-src ${PROD_ORIGIN}/_app/ 'sha256-`);
    expect(csp).not.toContain("unsafe-inline");
    await page.waitForLoadState("networkidle");
    // The client ran: its files were asked for, and nothing it did broke the policy or threw.
    expect(watched.scripts.length).toBeGreaterThan(0);
    await expect(page.locator("h1")).toHaveText(NOT_FOUND);
    expect(await noiseOf(page, watched)).toEqual([]);
    expect(dialogs).toEqual([]);
    await expectOnlyText(page);
    // The Sign in link comes back to this page: its `next` is the path alone, never the query, and only as a value.
    const path = new URL(page.url()).pathname;
    await expect(page.locator("header a", { hasText: "Sign in" }).first()).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(path)}`,
    );
  });
}

// The client took the error page over, so a link is followed in place and the shell's Sign in link follows the address.
// Going back to an address the client has no route for is the server's to answer: SvelteKit's client asks for the
// document again (kit 3.2.0 src/runtime/client/client.js:1998-2008 and 2302-2319, server_fallback), so the 404 a member
// is shown is always one the server drew.
test("the_client_takes_the_error_page_over", async ({ page }) => {
  const watched = watch(page);
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  expect((await page.goto(`${PROD_ORIGIN}/no/such/page`))?.status()).toBe(404);
  await page.waitForLoadState("networkidle");
  const signIn = page.locator("header a", { hasText: "Sign in" }).first();
  await expect(signIn).toHaveAttribute("href", "/login?next=%2Fno%2Fsuch%2Fpage");
  await page.locator('footer a[href="/legal/terms"]').click();
  await expect(page).toHaveURL(`${PROD_ORIGIN}/legal/terms`);
  await expect(page.locator("main h1")).not.toHaveText(NOT_FOUND);
  await expect(signIn).toHaveAttribute("href", "/login?next=%2Flegal%2Fterms");
  await page.goBack();
  await expect(page).toHaveURL(`${PROD_ORIGIN}/no/such/page`);
  await expect(page.locator("h1")).toHaveText(NOT_FOUND);
  await page.waitForLoadState("networkidle");
  expect(documents).toEqual([`${PROD_ORIGIN}/no/such/page`, `${PROD_ORIGIN}/no/such/page`]);
  expect(await noiseOf(page, watched)).toEqual([]);
});

/** What a click to `/@actor` did, with the actor set aside: the requests it made and the page it drew. */
type Drawn = { requests: string[]; title: string; main: string; url: string };

async function clickTo(page: Page, origin: string, actor: string): Promise<Drawn> {
  const requests: string[] = [];
  const note = (url: string, what: string) => requests.push(`${what} ${url.replaceAll(encodeURI(actor), "ACTOR")}`);
  const asked = (request: Request) => note(request.url(), `${request.method()} ${request.resourceType()}`);
  // The answers the client reads (a data address, a document); when the favicon's image arrives is the browser's own.
  // So is the status of a build file under /_app/, which no actor is part of: when a navigation ends at 400 or above
  // SvelteKit asks for /_app/version.json with `cache-control: no-cache` (kit 3.2.0 src/runtime/client/client.js
  // 2070-2072 and src/runtime/app/state/client.svelte.js 160-165), and from its second asking Firefox sends a validator
  // and is told 304 where Chromium is told 200. That it was asked for is still held equal, by the request.
  const answered = (response: Response) => {
    const read = ["fetch", "xhr", "document"].includes(response.request().resourceType());
    if (read && !new URL(response.url()).pathname.startsWith("/_app/")) note(response.url(), String(response.status()));
  };
  page.on("request", asked);
  page.on("response", answered);
  await click(page, `/@${actor}`);
  await expect(page).toHaveURL(`${origin}/@${actor}`);
  await expect(page.locator("h1")).toHaveText(NOT_FOUND);
  await page.waitForLoadState("networkidle");
  page.off("request", asked);
  page.off("response", answered);
  const main = await page.locator("main").innerHTML();
  return { requests: requests.sort(), title: await page.title(), main, url: page.url().replaceAll(actor, "ACTOR") };
}

/**
 * Rule SE-2 with the client drawing the page (ADR 0116 point 5): from a page that runs the client, a click to a
 * profile that is missing, hidden or under a handle nobody has draws the same error page and makes the same requests,
 * each answered alike. An erased member has no row left and is the missing one
 * (tests/integration/postgres/public-profile-store.test.ts erased_account_reads_as_missing).
 */
const NOBODY = [MISSING, HIDDEN.did, "nobody.unset.test"] as const;

test("a_click_to_any_profile_that_is_not_shown_is_the_same_404", async ({ page }) => {
  const watched = watch(page);
  const start = `${PROD_ORIGIN}/@${INDEXED.did}`;
  const drawn: Drawn[] = [];
  for (const actor of NOBODY) {
    expect((await page.goto(start))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    drawn.push(await clickTo(page, PROD_ORIGIN, actor));
  }
  // The client asked for the page's data and nothing else, and drew the page itself: no second document.
  expect(drawn[0]?.requests.some((line) => line.includes("/@ACTOR/__data.json"))).toBe(true);
  expect(drawn[0]?.requests.some((line) => line.includes(" document "))).toBe(false);
  for (const other of drawn.slice(1)) expect(other).toEqual(drawn[0]);
  expect(watched.pageErrors).toEqual([]);
  expect((await pageNoise(page, watched)).csp).toEqual([]);
});

const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};

// A member is told no more than a visitor: their click draws their own copy of the one 404, the same for each.
test("a_members_click_to_any_profile_that_is_not_shown_is_the_same_404", async ({ page }) => {
  const watched = watch(page);
  const drawn: Drawn[] = [];
  for (const actor of NOBODY) {
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    drawn.push(await clickTo(page, TEST_ORIGIN, actor));
  }
  for (const other of drawn.slice(1)) expect(other).toEqual(drawn[0]);
  expect(watched.pageErrors).toEqual([]);
  expect((await pageNoise(page, watched)).csp).toEqual([]);
});

// A member's error page has the theme picker, whose way back is the address they asked for: the server checks it when
// the choice is saved (routes/prefs/theme), and with the client running the choice is applied in place.
test("a_members_hostile_address_runs_nothing_and_its_theme_picker_saves", async ({ page }) => {
  const watched = watch(page);
  const fixture: PageFixture = { ...SETTINGS, path: HOSTILE_ADDRESSES[0], route: "" };
  expect((await openPage(page, fixture))?.status()).toBe(404);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1")).toHaveText(NOT_FOUND);
  await expectOnlyText(page);
  const menu = await openAccountMenu(page);
  const dark = menu.getByRole("menuitemradio", { name: "Dark" });
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/prefs/theme"));
  await dark.click();
  expect((await saved).request().postData()).toContain(`return=${encodeURIComponent(HOSTILE_ADDRESSES[0])}`);
  await expect(dark).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(`${TEST_ORIGIN}${HOSTILE_ADDRESSES[0]}`);
  await expectOnlyText(page);
  expect(await noiseOf(page, watched)).toEqual([]);
  await menu.getByRole("menuitemradio", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});

// With every script file refused the error page is the server's page: its links are plain links, and the only error
// is the start-up script reporting the import that failed (csp.spec.ts app_page_works_without_its_script).
test("the_error_page_reads_whole_with_its_script_files_refused", async ({ page }) => {
  await page.route("**/_app/**/*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
  const watched = watch(page);
  expect((await page.goto(`${PROD_ORIGIN}/no/such/page`))?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText(NOT_FOUND);
  await expect(page.locator("main")).toContainText("http.not_found");
  await expect.poll(() => watched.pageErrors).toHaveLength(1);
  expect((await pageNoise(page, watched)).csp).toEqual([]);
  await page.locator("main").getByRole("link", { name: "Go to the home page" }).click();
  await expect(page).toHaveURL(`${PROD_ORIGIN}/`);
});

// The client's files arrive and it throws while starting: the page stays the one the server drew, and a link is the
// browser's own navigation. The app entry is answered with a module that throws, so SvelteKit's start never runs.
test("the_error_page_reads_whole_when_the_client_fails_at_start", async ({ page }) => {
  await page.route("**/_app/immutable/entry/app.*.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: 'throw new Error("the client failed while starting");',
    }),
  );
  const watched = watch(page);
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  expect((await page.goto(`${PROD_ORIGIN}/no/such/page`))?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText(NOT_FOUND);
  // One page error, the thrown one: Chromium and Firefox give its message, WebKit puts the error's name before it.
  await expect.poll(() => watched.pageErrors).toHaveLength(1);
  expect(watched.pageErrors[0]).toMatch(/^(Error: )?the client failed while starting$/);
  await expect(page.locator('header a[href="/login?next=%2Fno%2Fsuch%2Fpage"]').first()).toBeVisible();
  expect((await pageNoise(page, watched)).csp).toEqual([]);
  await page.locator("main").getByRole("link", { name: "Go to the home page" }).click();
  await expect(page).toHaveURL(`${PROD_ORIGIN}/`);
  expect(documents).toEqual([`${PROD_ORIGIN}/no/such/page`, `${PROD_ORIGIN}/`]);
});

type DocumentLike = {
  createElement: (tag: string) => { href: string; click: () => void };
  body: { append: (node: object) => void };
};
