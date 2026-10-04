import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { main as cookieMain, scanCookieDomain } from "./cookie-domain.ts";
import { main as egressMain, scanEgress } from "./egress.ts";

const roots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "guards-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("egress guard", () => {
  test("flags fetch with a dynamic URL", () => {
    expect(scanEgress("apps/web/a.ts", "await fetch(url)").length).toBe(1);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text containing a template literal.
    expect(scanEgress("apps/web/a.ts", "await fetch(`https://${host}/x`)").length).toBe(1);
    expect(scanEgress("apps/web/a.ts", "await fetch(base + path, opts)").length).toBe(1);
  });

  test("allows a constant string URL", () => {
    expect(scanEgress("apps/web/a.ts", 'await fetch("https://plc.directory/x")').length).toBe(0);
    expect(scanEgress("apps/web/a.ts", "await fetch('https://a.example', { method: 'POST' })").length).toBe(0);
  });

  test("flags raw HTTP client imports", () => {
    expect(scanEgress("domains/identity/a.ts", 'import { request } from "undici";').length).toBe(1);
    expect(scanEgress("domains/identity/a.ts", 'import https from "node:https";').length).toBe(1);
  });

  test("exempts net-guard itself, tests, and annotated lines", () => {
    expect(scanEgress("infrastructure/net-guard/index.ts", "await fetch(url)").length).toBe(0);
    expect(scanEgress("apps/web/a.test.ts", "await fetch(url)").length).toBe(0);
    expect(scanEgress("apps/web/a.ts", "await fetch(url) // guard-allow: egress constant PDS URL").length).toBe(0);
  });

  test("main fails on a planted bare fetch and passes on a clean tree", () => {
    expect(egressMain(fixture({ "apps/web/ok.ts": "export const x = 1;\n" }))).toBe(0);
    expect(egressMain(fixture({ "domains/p/bad.ts": "export const go = (u: string) => fetch(u);\n" }))).toBe(1);
  });
});

describe("cookie-domain guard", () => {
  test("flags a Domain attribute in a Set-Cookie string", () => {
    expect(scanCookieDomain("apps/web/a.ts", '"sid=1; Path=/; Domain=unset.sh; Secure"').length).toBe(1);
  });

  test("flags a domain option next to cookie code", () => {
    const src = 'setCookie(c, "__Host-sid", sid, {\n  secure: true,\n  domain: "unset.sh",\n});';
    expect(scanCookieDomain("apps/web/a.ts", src).length).toBe(1);
  });

  test("ignores unrelated domain fields", () => {
    expect(scanCookieDomain("domains/identity/config.ts", "const handle = { domain: env.HANDLE_DOMAIN };").length).toBe(
      0,
    );
  });

  test("main fails on a planted Domain cookie", () => {
    expect(cookieMain(fixture({ "apps/web/s.ts": 'res.headers.set("set-cookie", "a=b; Domain=x.y");\n' }))).toBe(1);
    expect(cookieMain(fixture({ "apps/web/s.ts": 'res.headers.set("set-cookie", "__Host-a=b; Path=/");\n' }))).toBe(0);
  });
});
