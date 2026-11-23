// Book P1.22f (ADR 0114 point 5, ADR 0116): one build file the edge refuses leaves the server's page readable. Past
// its allowance the dev app edge's app_files zone answers a build file with an empty 429 (deployment/edge/snippets/
// ratelimit.caddy; a file is no navigation, so it gets no Too many tries page). Measured through that edge, a fourth
// visitor behind one address in the same 10 s loses some of a cold page's 32 files, a script or the stylesheet
// (docs/ai/notes/reference/visitors-behind-one-address.md). Here the browser gets that 429 for the first file of the
// kind the page asks for, and the page must still read: its own words and its plain links. These run against the web
// server alone (fixtures/servers.ts), the 429 made by the browser's route, as the edge sends it.
import { expect, type Page, test } from "@playwright/test";
import { INDEXED, PROD_ORIGIN } from "./pages.ts";

/** The pages a shared link most often brings a crowd to: a public profile, home, and an address no route matches. */
const PAGES = [
  { name: "profile", path: `/@${INDEXED.did}`, status: 200, words: "Public Member", runsClient: true },
  { name: "home", path: "/", status: 200, words: null, runsClient: false },
  {
    name: "unmatched",
    path: "/no-route-matches-this",
    status: 404,
    words: "That page does not exist.",
    runsClient: false,
  },
] as const;

/** The two kinds of build file a refusal can take from a page: one of its scripts, or its one stylesheet. */
const KINDS = {
  script: /^\/_app\/immutable\/.+\.js$/,
  stylesheet: /^\/_app\/immutable\/assets\/.+\.css$/,
} as const;

/** Answers the first build file matching `kind` with the edge's 429 and lets every other request through. */
async function refuseFirst(page: Page, kind: RegExp): Promise<string[]> {
  const refused: string[] = [];
  await page.route("**/_app/immutable/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (refused.length > 0 || !kind.test(path)) return route.continue();
    refused.push(path);
    return route.fulfill({ status: 429, headers: { "retry-after": "10" }, body: "" });
  });
  return refused;
}

for (const target of PAGES) {
  for (const [kind, pattern] of Object.entries(KINDS)) {
    test(`the_${target.name}_page_reads_with_${kind}_refused`, async ({ page }) => {
      const refused = await refuseFirst(page, pattern);
      const response = await page.goto(PROD_ORIGIN + target.path);
      expect(response?.status()).toBe(target.status);
      await page.waitForLoadState("networkidle");
      // A page without the client asks for no script, so nothing is refused there; P1.22k turns these on.
      expect(refused).toHaveLength(kind === "script" && !target.runsClient ? 0 : 1);
      if (target.words !== null) {
        await expect(page.getByText(target.words, { exact: true }).filter({ visible: true }).first()).toBeVisible();
      }
      // The plain links still lead somewhere: the navbar's way home and the footer's terms.
      await expect(page.locator('header a[href="/"]').filter({ visible: true }).first()).toBeVisible();
      await expect(page.locator('footer a[href="/legal/terms"]').filter({ visible: true })).toBeVisible();
    });
  }
}
