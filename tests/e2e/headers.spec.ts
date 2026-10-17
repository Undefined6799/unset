import { expect, test } from "@playwright/test";
import { cellName, PAGES, requestHeaders, themeCells } from "./pages.ts";

// shared/http/csp/headers.ts sets HSTS on every group, including dev. The book text said "absent in
// dev"; the kit does not, and this harness does not change it.
const HSTS = "max-age=63072000; includeSubDomains";

function header(headers: Record<string, string>, name: string): string | undefined {
  return headers[name];
}

for (const fixture of PAGES) {
  for (const cell of themeCells(fixture)) {
    test(`headers ${fixture.path} ${cellName(cell)}`, async ({ request }) => {
      const response = await request.get(fixture.path, { headers: requestHeaders(cell), maxRedirects: 0 });
      expect(response.status()).toBe(200);
      const headers = response.headers();
      const csp = header(headers, "content-security-policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      if (fixture.group === "public") {
        expect(csp).not.toContain("script-src");
        expect(header(headers, "vary")).toBeUndefined();
      } else {
        expect(csp).toContain("script-src");
        expect(csp).toContain("trusted-types");
        expect(header(headers, "vary")).toBe("Cookie");
        expect(header(headers, "cache-control")).toBe("private, no-store");
      }
      expect(header(headers, "x-content-type-options")).toBe("nosniff");
      expect(header(headers, "referrer-policy")).toBe("same-origin");
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
