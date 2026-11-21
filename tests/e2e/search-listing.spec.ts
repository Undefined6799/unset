// P1.21b: the site-wide Search and AI switch, off by default and so off on both e2e servers, as on staging. With and
// without JavaScript, a page that would otherwise be indexable keeps `noindex` in its header and in its markup once the
// client has run, and the member's Search and AI settings say plainly that listing is off on this site.
// tests/integration/web/public/search-and-ai.test.ts covers robots.txt, the sitemap and both states of the switch.
import { expect, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { INDEXED, PAGES, type PageFixture } from "./pages.ts";

const SETTINGS: PageFixture = {
  path: "/settings/privacy",
  route: "/settings/privacy",
  group: "app",
  expectJs: true,
  member: "account",
};
const OPEN_PAGES = ["/", "/signed-out", `/@${INDEXED.did}`].map((path) => {
  const fixture = PAGES.find((one) => one.path === path);
  if (fixture === undefined) throw new Error(`pages.ts has no ${path}`);
  return fixture;
});

for (const javaScriptEnabled of [true, false]) {
  test.describe(`search listing off, javascript ${javaScriptEnabled ? "on" : "off"}`, () => {
    test.use({ javaScriptEnabled });

    for (const fixture of OPEN_PAGES) {
      test(`noindex ${fixture.path}`, async ({ page }) => {
        const response = await openPage(page, fixture);
        expect(response?.status()).toBe(200);
        expect(response?.headers()["x-robots-tag"]).toBe("noindex");
        await page.waitForLoadState("networkidle");
        await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", "noindex");
      });
    }

    test("the_settings_say_listing_is_off_on_this_site", async ({ page }) => {
      expect((await openPage(page, SETTINGS))?.status()).toBe(200);
      const section = page.locator("#search-and-ai");
      await expect(section).toContainText("Search and AI listing is switched off on this site");
      await expect(page.getByRole("button", { name: "Save privacy" })).toBeVisible();
    });
  });
}
