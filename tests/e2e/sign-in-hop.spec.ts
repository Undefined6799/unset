// Book P1.22l (ADR 0116 point 4): the hop between the sign-in form and the sign-in server is the one page of the
// sign-in that keeps no script, so leaving never waits for a file. It is sent the fixed policy with no script-src at
// all (hooks.server.ts), and under that policy a browser still loads its stylesheet, reports nothing refused, and its
// refresh still leaves for the address this browser's own POST stored. tests/integration/web/sign-in.test.ts holds how that address
// gets into the cookie and what the page says of it.
import { expect, test } from "@playwright/test";
import { watch, withoutFaviconProbe } from "./observe.ts";
import { PROD_ORIGIN } from "./pages.ts";

/** An authorization address on a host that does not exist: the test answers the request, so nothing is ever sent. */
const TARGET = "https://sign-in.invalid/oauth/authorize?request_uri=urn%3Ax";

test("the_hop_to_the_sign_in_server_runs_nothing_and_is_styled", async ({ page, context }) => {
  // The cookie POST /login leaves for the hop: the address, base64url (interfaces/web sign-in-state.ts).
  await context.addCookies([
    {
      name: "__Host-login_target",
      value: Buffer.from(TARGET).toString("base64url"),
      url: PROD_ORIGIN,
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  // The refresh leaves at once, so nothing here waits on the page: the test reads the answer's own bytes and what the
  // browser asked for and reported while it drew them. The request the refresh makes is answered 204 No Content and
  // never leaves this machine.
  const left: string[] = [];
  await page.route(
    (url) => url.origin !== PROD_ORIGIN,
    (route) => {
      left.push(route.request().url());
      return route.fulfill({ status: 204 });
    },
  );
  const watched = watch(page);
  const styles: string[] = [];
  page.on("requestfinished", (request) => {
    if (request.resourceType() === "stylesheet") styles.push(request.url());
  });
  const response = await page.goto(`${PROD_ORIGIN}/login/continue`);
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toContain("script-src");
  const html = (await response?.text()) ?? "";
  expect(html).toContain("You are going to <strong>sign-in.invalid</strong>");
  expect(html).toContain(`href="${TARGET}"`);
  expect(html).not.toContain("<script");

  // The page leaves by itself, for the stored address and nowhere else.
  await expect.poll(() => left).toEqual([TARGET]);
  // By then it was drawn: the stylesheet the policy allows was loaded from the build, no script was asked for, and
  // the browser reported nothing the policy refused.
  expect(styles.length).toBeGreaterThan(0);
  for (const style of styles) expect(style).toContain(`${PROD_ORIGIN}/_app/`);
  expect(watched.scripts).toEqual([]);
  expect(withoutFaviconProbe([...watched.csp, ...watched.consoleErrors], html)).toEqual([]);
  expect(watched.pageErrors).toEqual([]);
});
