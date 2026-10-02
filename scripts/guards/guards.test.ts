import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { main as cookieMain, scanCookieDomain } from "./cookie-domain.ts";
import { main as egressMain, scanEgress } from "./egress.ts";
import { discoverTests, missingFiles } from "./run-tests.ts";

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
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("egress guard", () => {
  test("flags fetch with a dynamic URL", () => {
    assert.equal(scanEgress("apps/web/a.ts", "await fetch(url)").length, 1);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text containing a template literal.
    assert.equal(scanEgress("apps/web/a.ts", "await fetch(`https://${host}/x`)").length, 1);
    assert.equal(scanEgress("apps/web/a.ts", "await fetch(base + path, opts)").length, 1);
  });

  test("allows a constant string URL", () => {
    assert.equal(scanEgress("apps/web/a.ts", 'await fetch("https://plc.directory/x")').length, 0);
    assert.equal(scanEgress("apps/web/a.ts", "await fetch('https://a.example', { method: 'POST' })").length, 0);
  });

  test("flags raw HTTP client imports", () => {
    assert.equal(scanEgress("packages/core/a.ts", 'import { request } from "undici";').length, 1);
    assert.equal(scanEgress("packages/core/a.ts", 'import https from "node:https";').length, 1);
  });

  test("exempts net-guard itself, tests, and annotated lines", () => {
    assert.equal(scanEgress("packages/net-guard/index.ts", "await fetch(url)").length, 0);
    assert.equal(scanEgress("apps/web/a.test.ts", "await fetch(url)").length, 0);
    assert.equal(scanEgress("apps/web/a.ts", "await fetch(url) // guard-allow: egress constant PDS URL").length, 0);
  });

  test("main fails on a planted bare fetch and passes on a clean tree", () => {
    assert.equal(egressMain(fixture({ "apps/web/ok.ts": "export const x = 1;\n" })), 0);
    assert.equal(egressMain(fixture({ "plugins/p/bad.ts": "export const go = (u: string) => fetch(u);\n" })), 1);
  });
});

describe("cookie-domain guard", () => {
  test("flags a Domain attribute in a Set-Cookie string", () => {
    assert.equal(scanCookieDomain("apps/web/a.ts", '"sid=1; Path=/; Domain=unset.sh; Secure"').length, 1);
  });

  test("flags a domain option next to cookie code", () => {
    const src = 'setCookie(c, "__Host-sid", sid, {\n  secure: true,\n  domain: "unset.sh",\n});';
    assert.equal(scanCookieDomain("apps/web/a.ts", src).length, 1);
  });

  test("ignores unrelated domain fields", () => {
    assert.equal(
      scanCookieDomain("packages/core/config.ts", "const handle = { domain: env.HANDLE_DOMAIN };").length,
      0,
    );
  });

  test("main fails on a planted Domain cookie", () => {
    assert.equal(cookieMain(fixture({ "apps/web/s.ts": 'res.headers.set("set-cookie", "a=b; Domain=x.y");\n' })), 1);
    assert.equal(cookieMain(fixture({ "apps/web/s.ts": 'res.headers.set("set-cookie", "__Host-a=b; Path=/");\n' })), 0);
  });
});

describe("test runner accounting", () => {
  test("reports discovered files that produced no results", () => {
    const root = "/repo";
    const reported = ["/repo/apps/web/a.test.ts", "/repo/apps/web/a.test.ts"];
    assert.deepEqual(missingFiles(root, ["apps/web/a.test.ts", "apps/web/b.test.ts"], reported), [
      "apps/web/b.test.ts",
    ]);
  });

  test("discovers *.test.ts under the scanned dirs only", () => {
    const root = fixture({
      "packages/core/x.test.ts": "",
      "apps/web/y.test.ts": "",
      "apps/web/node_modules/z.test.ts": "",
      "docs/w.test.ts": "",
    });
    assert.deepEqual(discoverTests(root), ["apps/web/y.test.ts", "packages/core/x.test.ts"]);
  });
});
