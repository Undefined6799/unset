import { expect, test } from "@playwright/test";
import { ALL_PAGES, cellName, INDEXED, JOIN_CODE, originOf, PAGES, requestHeaders, themeCells } from "./pages.ts";

// shared/http/headers.ts sets HSTS everywhere, including dev (interfaces/web/server.ts applies SECURITY_HEADERS).
// The book text said "absent in dev"; the server does not, and this harness does not change it.
const HSTS = "max-age=63072000; includeSubDomains";

// Home and the legal pages read a member's session (policy session "optional", P1.20k), so even a visitor's copy
// varies on Cookie; so does a member's public page, which reads one to know who is looking (ADR 0078). Other public
// pages read none.
const OPTIONAL_SESSION = new Set([
  "/",
  `/@${INDEXED.did}`,
  "/legal/terms",
  "/legal/privacy",
  "/legal/domains",
  `/join?invite=${JOIN_CODE}`,
  "/request-invite",
]);
// P2.10: /join's URL holds an invite code, so it sends no Referer at all (routes/join/+page.server.ts).
const referrerPolicy = (route: string): string => (route === "/join" ? "no-referrer" : "same-origin");

function header(headers: Record<string, string>, name: string): string | undefined {
  return headers[name];
}

for (const fixture of ALL_PAGES) {
  for (const cell of themeCells(fixture)) {
    test(`headers ${fixture.path} ${cellName(cell)}`, async ({ request }) => {
      const response = await request.get(`${originOf(fixture)}${fixture.path}`, {
        headers: requestHeaders(cell, fixture),
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      const headers = response.headers();
      const csp = header(headers, "content-security-policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      if (fixture.group === "public") {
        // A public page that runs the client (ADR 0114, ADR 0116: the profile, home, the legal pages, the invite
        // request) has the app group's script policy and keeps its own cache rule (the profile's is a minute); a
        // public page without the client allows no script at all.
        if (fixture.expectJs) {
          expect(csp).toContain(`script-src ${originOf(fixture)}/_app/ 'sha256-`);
          expect(csp).toContain("require-trusted-types-for 'script'");
          expect(csp).not.toContain("unsafe-inline");
          expect(csp).not.toContain("unsafe-eval");
          if (fixture.route === "/@:actor") expect(header(headers, "cache-control")).toBe("public, max-age=60");
        } else {
          expect(csp).not.toContain("script-src");
        }
        expect(header(headers, "vary")).toBe(OPTIONAL_SESSION.has(fixture.path) ? "Cookie" : undefined);
      } else {
        expect(csp).toContain("script-src");
        expect(csp).toContain("trusted-types");
        expect(header(headers, "vary")).toBe("Cookie");
        expect(header(headers, "cache-control")).toBe("private, no-store");
      }
      expect(header(headers, "x-content-type-options")).toBe("nosniff");
      expect(header(headers, "referrer-policy")).toBe(referrerPolicy(fixture.route));
      expect(header(headers, "strict-transport-security")).toBe(HSTS);
    });
  }
}

test("public stray __Host-theme is byte-identical", async ({ request }) => {
  for (const fixture of PAGES.filter((page) => page.group === "public")) {
    const plain = await request.get(fixture.path, { maxRedirects: 0, headers: { "accept-language": "en" } });
    expect(plain.status()).toBe(200);
    const plainBody = await plain.body();
    for (const theme of ["dark", "light", "nope"]) {
      const stray = await request.get(fixture.path, {
        maxRedirects: 0,
        headers: { "accept-language": "en", cookie: `__Host-theme=${theme}` },
      });
      expect(stray.status()).toBe(200);
      expect(Buffer.compare(await stray.body(), plainBody)).toBe(0);
      expect(stray.headers()["content-security-policy"]).toBe(plain.headers()["content-security-policy"]);
      expect(stray.headers().vary).toBe(plain.headers().vary);
    }
  }
});
