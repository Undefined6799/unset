// P2.24d spike only: fonts through the existing edge for the official PDS pages (ADR 0027).
// CSP font-src path matching: CSP Level 3, "Does url match expression in origin with redirect count?", path part.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const FONT_SRC = "font-src https://pds.test/_unset/fonts/";
const FONT = "/_unset/fonts/SpaceGrotesk-Variable.woff2";
const PAGES = [
  { path: "/account", upstream: "upstream-_account_.txt" },
  { path: "/oauth/authorize?client_id=x", upstream: "upstream-_oauth_authorize_client_id_x_.txt" },
];

type Policy = Map<string, string[]>;
function parse(csp: string): Policy {
  const policy: Policy = new Map();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) policy.set(name.toLowerCase(), values);
  }
  return policy;
}
// Hashes and nonces may differ per response; everything else must be identical.
const shape = (policy: Policy) =>
  [...policy].map(([name, values]) => [name, values.map((v) => v.replace(/^'(sha256|nonce)-[^']+'$/, "'$1-*'"))]);
function upstream(file: string): string {
  const text = readFileSync(join(process.env.RUNNER_TEMP ?? "", "p224d", file), "utf8");
  const line = text.split("\n").find((l) => /^\s*content-security-policy:/i.test(l));
  if (!line) throw new Error(`no upstream CSP in ${file}:\n${text}`);
  return line.slice(line.indexOf(":") + 1).trim();
}
async function loadFont(page: Page, url: string) {
  return page.evaluate(async (src) => {
    const violations: string[] = [];
    const listener = (e: SecurityPolicyViolationEvent) => violations.push(`${e.effectiveDirective} ${e.blockedURI}`);
    document.addEventListener("securitypolicyviolation", listener);
    try {
      const face = new FontFace("SpikeFace", `url(${src})`);
      await face.load();
      document.fonts.add(face);
      return { loaded: true, applied: document.fonts.check('16px "SpikeFace"'), violations };
    } catch (error) {
      await new Promise((r) => setTimeout(r, 200));
      return { loaded: false, applied: false, violations, error: String(error) };
    } finally {
      document.removeEventListener("securitypolicyviolation", listener);
    }
  }, url);
}

for (const { path, upstream: file } of PAGES) {
  test.describe(`HTML page ${path}`, () => {
    test("gets exactly one appended font-src and keeps every upstream directive", async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.headers()["content-type"]).toMatch(/^text\/html/);
      const csp = response?.headers()["content-security-policy"] ?? "";
      const original = upstream(file);
      expect(csp.endsWith(`; ${FONT_SRC}`)).toBe(true);
      expect(csp.match(/font-src/g)?.length).toBe(1);
      expect(original).not.toMatch(/font-src/);
      expect(shape(parse(csp.slice(0, -`; ${FONT_SRC}`.length)))).toEqual(shape(parse(original)));
      expect(csp).not.toMatch(/\*|data:|blob:/);
      for (const [name, value] of Object.entries(response?.headers() ?? {}))
        test.info().annotations.push({ type: "header", description: `${name}: ${value}` });
    });
    test("loads and applies the same-origin font from the fixed path", async ({ page }) => {
      await page.goto(path);
      const fontResponse = page.waitForResponse((r) => r.url().endsWith(FONT));
      const result = await loadFont(page, FONT);
      expect(result).toMatchObject({ loaded: true, applied: true, violations: [] });
      const font = await fontResponse;
      expect(font.status()).toBe(200);
      expect(font.headers()["content-type"]).toBe("font/woff2");
    });
    test("blocks fonts from any other source", async ({ page }) => {
      await page.goto(path);
      for (const url of [
        "https://example.com/x.woff2",
        "/xrpc/_health",
        "/_unset/fonts-other/x.woff2",
        "data:font/woff2;base64,AAAA",
      ]) {
        const result = await loadFont(page, url);
        expect(result.loaded, url).toBe(false);
        expect(result.violations.some((v) => v.startsWith("font-src")), `${url}: ${result.violations}`).toBe(true);
      }
    });
  });
}

test("non-HTML responses keep their own headers", async ({ request }) => {
  const health = await request.get("/xrpc/_health");
  expect(health.headers()["content-type"]).toMatch(/^application\/json/);
  expect(health.headers()["content-security-policy"] ?? "").not.toMatch(/font-src/);
  const describe = await request.get("/xrpc/com.atproto.server.describeServer");
  expect(describe.headers()["content-security-policy"] ?? "").not.toMatch(/font-src/);
  const font = await request.get(FONT);
  expect(font.headers()["content-security-policy"]).toBeUndefined();
  expect(font.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the font path serves only woff2 files", async ({ request }) => {
  for (const path of ["/_unset/fonts/OFL-SpaceGrotesk.txt", "/_unset/fonts/", "/_unset/fonts/../Caddyfile"])
    expect((await request.get(path)).status(), path).toBe(404);
});
