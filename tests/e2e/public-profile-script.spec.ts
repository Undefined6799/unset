// Book P1.22e (ADR 0114): the public profile runs SvelteKit's client under the app group's script policy, and a
// member's text is still only text. HOSTILE (pages.ts; seeded by fixtures/servers.ts) is a member whose name, headline
// and every card field are `</script><script>`, an element with an `onerror` handler and a `javascript:` address, each
// of which would set `globalThis.ran` if a browser ever ran it. With script on, nothing runs, the policy reports no
// violation and the words are shown as written; with script off, and with every script file refused, the server's
// page still reads whole (ADR 0114 point 5). tests/integration/web/public/public-profile.test.ts holds the same page's
// header by value and the data its start-up script carries.
import { expect, type Page, test } from "@playwright/test";
import { pageNoise, watch } from "./observe.ts";
import { HOSTILE, PROD_ORIGIN } from "./pages.ts";

const PROFILE = `${PROD_ORIGIN}/@${HOSTILE.did}`;

type Probe = { ran?: unknown };

/** Nothing the member wrote ran or became markup: no global set, no element, handler or script address of theirs. */
async function expectOnlyText(page: Page): Promise<void> {
  expect(await page.evaluate(() => (globalThis as unknown as Probe).ran)).toBeUndefined();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator("[onerror]")).toHaveCount(0);
  await expect(page.locator('[href^="javascript:" i], [src^="javascript:" i], [action^="javascript:" i]')).toHaveCount(
    0,
  );
  // The one script element is SvelteKit's start-up script; the member's `<script>` is text beside it.
  await expect(page.locator("script")).toHaveCount(1);
}

/** The first place the page shows `text` whole (the About panel holds a hidden copy of the headline). */
const shown = (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true }).first();

/** The first visible link to `href` in the page's main region (the About panel repeats the contact button). */
const link = (page: Page, href: string) => page.locator(`main a[href="${href}"]`).filter({ visible: true }).first();

/** The page reads whole: the member's words as they wrote them, and the real link beside the script address. */
async function expectReadsWhole(page: Page): Promise<void> {
  await expect(page.locator("main")).toBeVisible();
  await expect(shown(page, HOSTILE.close)).toBeVisible();
  await expect(shown(page, HOSTILE.handler)).toBeVisible();
  await expect(shown(page, HOSTILE.address)).toBeVisible();
  await expect(link(page, "https://hostile.example/one")).toBeVisible();
  await expect(link(page, "https://hostile.example/call")).toBeVisible();
}

test("hostile_text_runs_nothing_with_script_on", async ({ page }) => {
  const watched = watch(page);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const response = await page.goto(PROFILE);
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain(`script-src ${PROD_ORIGIN}/_app/ 'sha256-`);
  expect(csp).not.toContain("unsafe-inline");
  await page.waitForLoadState("networkidle");
  // The client ran: its files were asked for, and nothing it did broke the policy or threw.
  expect(watched.scripts.length).toBeGreaterThan(0);
  const noise = await pageNoise(page, watched);
  expect(noise.csp).toEqual([]);
  expect(noise.consoleErrors).toEqual([]);
  expect(watched.pageErrors).toEqual([]);
  expect(dialogs).toEqual([]);
  await expectReadsWhole(page);
  await expectOnlyText(page);
});

// The client took the page over, so a link is followed in place: no second document is asked for, and the member's
// text is still text on the page the client drew last.
test("the_client_follows_a_link_in_place_and_back", async ({ page }) => {
  const watched = watch(page);
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  expect((await page.goto(PROFILE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.locator('footer a[href="/legal/terms"]').click();
  await expect(page).toHaveURL(`${PROD_ORIGIN}/legal/terms`);
  await expect(page.locator("main h1")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(PROFILE);
  await expectReadsWhole(page);
  await expectOnlyText(page);
  expect(documents).toEqual([PROFILE]);
  const noise = await pageNoise(page, watched);
  expect(noise.csp).toEqual([]);
  expect(watched.pageErrors).toEqual([]);
});

// A visitor's copy of the profile follows the system and is the same bytes for everyone; a sign-in page follows the
// theme the visitor chose (the `__Host-theme` cookie). The client follows the link in place, so the document stays:
// the shell gives it the theme a full load of the new page would have, both ways.
test("a_page_reached_in_place_has_the_theme_a_full_load_gives_it", async ({ page, context }) => {
  await context.addCookies([{ name: "__Host-theme", value: "dark", url: PROD_ORIGIN, secure: true, sameSite: "Lax" }]);
  await page.emulateMedia({ colorScheme: "light" });
  const html = page.locator("html");
  const scheme = page.locator('meta[name="color-scheme"]');
  expect((await page.goto(PROFILE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await expect(html).not.toHaveAttribute("data-theme", /./);
  await page.locator('a[href^="/login"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(scheme).toHaveAttribute("content", "dark");
  await page.goBack();
  await expect(page).toHaveURL(PROFILE);
  await expect(html).not.toHaveAttribute("data-theme", /./);
  await expect(scheme).toHaveAttribute("content", "dark light");
});

// With every script file refused the page is the server's page: the only error is the start-up script reporting the
// import that failed, as on an app page (csp.spec.ts app_page_works_without_its_script).
test("the_page_reads_whole_with_its_script_files_refused", async ({ page }) => {
  await page.route("**/_app/**/*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
  const watched = watch(page);
  expect((await page.goto(PROFILE))?.status()).toBe(200);
  await expectReadsWhole(page);
  await expectOnlyText(page);
  expect(watched.pageErrors).toHaveLength(1);
  expect((await pageNoise(page, watched)).csp).toEqual([]);
});

test.describe("javascript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the_page_reads_whole_with_script_off", async ({ page }) => {
    const watched = watch(page);
    expect((await page.goto(PROFILE))?.status()).toBe(200);
    await expectReadsWhole(page);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator("[onerror]")).toHaveCount(0);
    await expect(page.locator('[href^="javascript:" i]')).toHaveCount(0);
    expect(watched.pageErrors).toEqual([]);
  });
});
