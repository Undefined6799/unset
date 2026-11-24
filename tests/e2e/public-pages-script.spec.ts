// Book P1.22g and P1.22l (ADR 0116): home, the legal pages and the invite request, then the sign-in page, the join
// page and the under-age notice, run SvelteKit's client under the app group's script policy. Each reads something of
// the query: every page `?error=`, a catalog code a redirect carried; the invite request `?sent`, which says the
// form was taken; the sign-in page `?next`, where to go after; the join page `?invite`, the code it shows. Anyone can
// send anyone a link with any query, so what the query holds must stay text: with script on nothing of it runs, the
// policy reports no violation, and the page shows its own words. tests/integration/web holds the bytes of each
// page's start-up script against the same values (public/public-pages.test.ts, public/request-invite.test.ts,
// sign-in.test.ts, app/invite.test.ts, welcome/onboarding.test.ts), and nojs.spec.ts reads the pages with script off.
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

const BLOCKED_TITLE = "We can't offer you an account right now";

/**
 * Each page switched on, the query value it reads, and the heading it shows whatever that value says. `lead` goes
 * before each value: the sign-in page keeps `next` only when it is a path, so there the values are tried as one too.
 */
const PLACES = [
  { name: "home", path: "/", reads: "error", lead: "", heading: "Home" },
  { name: "a_legal_page", path: "/legal/terms", reads: "error", lead: "", heading: "Terms" },
  { name: "the_invite_request", path: "/request-invite", reads: "error", lead: "", heading: "Request an invite" },
  {
    name: "the_invite_request_s_sent_flag",
    path: "/request-invite",
    reads: "sent",
    lead: "",
    heading: "Request an invite",
  },
  { name: "the_sign_in_page", path: "/login", reads: "error", lead: "", heading: "Sign in" },
  { name: "the_sign_in_page_s_next", path: "/login", reads: "next", lead: "", heading: "Sign in" },
  { name: "the_sign_in_page_s_next_as_a_path", path: "/login", reads: "next", lead: "/", heading: "Sign in" },
  { name: "the_join_page_s_invite", path: "/join", reads: "invite", lead: "", heading: "You're invited to unset" },
  { name: "the_under_age_notice", path: "/welcome/blocked", reads: "error", lead: "", heading: BLOCKED_TITLE },
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
      const response = await page.goto(`${PROD_ORIGIN}${place.path}?${place.reads}=${place.lead}${value}`);
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

// With script on the sign-in page is still one plain form: the button posts the page itself, a navigation and not a
// fetch, with the checked path. The hop to the sign-in server (/login/continue, which keeps no script) therefore
// never waits for the client. Nothing leaves the test server here.
test("the_sign_in_button_posts_a_plain_form_with_script_on", async ({ page }) => {
  const watched = watch(page);
  await page.route(
    (url) => url.origin !== PROD_ORIGIN,
    (route) => route.abort(),
  );
  await page.goto(`${PROD_ORIGIN}/login?next=/legal/terms`);
  await page.waitForLoadState("networkidle");
  expect(watched.scripts.length).toBeGreaterThan(0);
  const posted = page.waitForRequest((request) => request.method() === "POST");
  await page.getByRole("button", { name: "Sign in with AtProto" }).click();
  const request = await posted;
  expect(new URL(request.url()).pathname).toBe("/login");
  expect(request.isNavigationRequest()).toBe(true);
  expect(Object.fromEntries(new URLSearchParams(request.postData() ?? ""))).toEqual({
    next: "/legal/terms",
    intent: "chooser",
  });
});

// The twin of nojs.spec.ts's login_close_returns_to_the_page_before. With script the client follows Sign in in place
// and asks the sign-in page's data address; the browser sends that request's Referer as the page the visitor is on,
// so Close still leads back to it.
test("close_returns_to_the_page_before_with_script_on", async ({ page }) => {
  await page.goto(`${PROD_ORIGIN}/legal/terms`);
  await page.waitForLoadState("networkidle");
  await page.locator('header a[href="/login?next=%2Flegal%2Fterms"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login\?next=%2Flegal%2Fterms$/);
  const close = page.getByRole("region", { name: "Sign in" }).getByRole("link", { name: "Close" });
  await expect(close).toHaveAttribute("href", "/legal/terms");
  await close.click();
  await expect(page).toHaveURL(/\/legal\/terms$/);
});
