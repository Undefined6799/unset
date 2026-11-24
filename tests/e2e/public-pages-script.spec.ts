// Book P1.22g (ADR 0116): home, the legal pages and the invite request run SvelteKit's client under the app group's
// script policy. Each reads something of the query: every page `?error=`, a catalog code a redirect carried, and the
// invite request `?sent`, which says the form was taken. Anyone can send anyone a link with any query, so what the
// query holds must stay text: with script on nothing of it runs, the policy reports no violation, and the page shows
// its own words. tests/integration/web/public holds the bytes of each page's start-up script against the same values
// (public-pages.test.ts, request-invite.test.ts), and nojs.spec.ts reads the pages with script off.
import { expect, test } from "@playwright/test";
import { expectOnlyText, pageNoise, watch } from "./observe.ts";
import { PROD_ORIGIN } from "./pages.ts";

/**
 * Values that would set `globalThis.ran` if a browser ever read one as markup, as script or as a link: a closed
 * script element, an open comment, a quote that ends an attribute, the two line separators JavaScript once ended a
 * string at (U+2028, U+2029), and a `javascript:` address.
 */
const HOSTILE_VALUES = [
  "%3C%2Fscript%3E%3Cscript%3EglobalThis.ran=1%3C%2Fscript%3E",
  "%3C!--%3Cscript%3EglobalThis.ran=1%3C%2Fscript%3E",
  "%22%27%3E%3Cimg%20src=x%20onerror=%22globalThis.ran=1%22%3E",
  "a%E2%80%A8globalThis.ran=1%E2%80%A9",
  "javascript:globalThis.ran=1",
] as const;

const RECEIVED = "Thanks, your request is in. If an invite is possible, it comes to that address by email.";

/** Each page switched on, the query value it reads, and the heading it shows whatever that value says. */
const PLACES = [
  { name: "home", path: "/", reads: "error", heading: "Home" },
  { name: "a_legal_page", path: "/legal/terms", reads: "error", heading: "Terms" },
  { name: "the_invite_request", path: "/request-invite", reads: "error", heading: "Request an invite" },
  { name: "the_invite_request_s_sent_flag", path: "/request-invite", reads: "sent", heading: "Request an invite" },
] as const;

for (const place of PLACES) {
  test(`a_hostile_query_runs_nothing_with_script_on_${place.name}`, async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    for (const value of HOSTILE_VALUES) {
      const watched = watch(page);
      const response = await page.goto(`${PROD_ORIGIN}${place.path}?${place.reads}=${value}`);
      expect(response?.status(), value).toBe(200);
      const csp = response?.headers()["content-security-policy"] ?? "";
      expect(csp, value).toContain(`script-src ${PROD_ORIGIN}/_app/ 'sha256-`);
      expect(csp, value).not.toContain("unsafe-inline");
      await page.waitForLoadState("networkidle");
      // The client ran: its files were asked for, and nothing it did broke the policy or threw.
      expect(watched.scripts.length, value).toBeGreaterThan(0);
      const noise = await pageNoise(page, watched);
      expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors], value).toEqual([]);
      await expectOnlyText(page);
      // The page shows its own words: its heading, and neither the error callout nor the "request is in" line, which
      // only a catalog code and `sent=1` bring.
      await expect(page.locator("h1").first(), value).toContainText(place.heading);
      await expect(page.locator("main [role=alert]"), value).toHaveCount(0);
      await expect(page.getByText(RECEIVED), value).toHaveCount(0);
    }
    expect(dialogs).toEqual([]);
  });
}

// The two values that do change a page, with script on as with it off: a catalog code shows its own sentence, and
// `sent=1` shows that the request is in.
test("a_catalog_code_and_the_sent_flag_show_their_words_with_script_on", async ({ page }) => {
  const watched = watch(page);
  await page.goto(`${PROD_ORIGIN}/?error=csrf.denied`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main [role=alert]")).toContainText("The form expired or came from another site.");
  await page.goto(`${PROD_ORIGIN}/request-invite?sent=1`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status")).toHaveText(RECEIVED);
  expect(watched.scripts.length).toBeGreaterThan(0);
  expect(watched.pageErrors).toEqual([]);
});
