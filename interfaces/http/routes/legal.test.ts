// P2.15 (routes/legal.ts, routes/security-txt.ts): the three pages and security.txt through the web server.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { PRIVACY_VERSION, TERMS_VERSION } from "@unset/domains-identity";
import { ConfigError, loadConfig } from "@unset/shared-config";
import { afterAll, describe, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import {
  PRIVACY_OFFICER_CONTACT_TOKEN,
  PRIVACY_OFFICER_TITLE_TOKEN,
  SECURITY_CONTACT_PAGE,
  SECURITY_TXT_EXPIRES,
  SUPPORT_EMAIL_TOKEN,
} from "../legal-placeholders.ts";
import { securityTxtExpiry } from "../security-txt.ts";
import { webTestEnv } from "../test-env.ts";

const ORIGIN = "https://unset.test";
const DAY_MS = 86_400_000;
const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));
const TESTDATA = fileURLToPath(new URL("../web/testdata/", import.meta.url));
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));

const TITLE = "<b>x</b>";
const ENV = webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN, WEB_BUILD_DIR: TESTDATA, PRIVACY_OFFICER_TITLE: TITLE });
const { server } = await compose(loadConfig(config, ENV), web);

const PAGES = ["/legal/terms", "/legal/privacy", "/legal/domains"];
const BANNER = "This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice.";

const get = (path: string, method = "GET") =>
  server.request(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1" },
    }),
    "10.0.0.1",
  );

/** An RFC 3339 instant with no fractional seconds. */
const stamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function load(extra: Record<string, string>) {
  return loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN, ...extra }));
}

describe("legal pages", () => {
  test("legal.zero_js", async () => {
    const home = await get("/");
    const health = await get("/health");
    for (const path of PAGES) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-security-policy"), path).toBe(home.headers.get("content-security-policy"));
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex");
      const html = await response.text();
      expect(html, path).not.toContain("<script");
      expect(html, path).toContain(`lang="en"`);
      expect(html, path).not.toContain(`lang="fr"`);
      const main = html.slice(html.indexOf("<main"));
      expect(main.startsWith(`<main id="main"><p>${BANNER}</p>`), path).toBe(true);
      const french = await (await get(`${path}?lang=fr`)).text();
      expect(french, path).toBe(html);
    }
    const security = await get("/.well-known/security.txt");
    expect(security.headers.get("content-security-policy")).toBe(health.headers.get("content-security-policy"));
    expect(await security.text()).not.toContain("<script");
  });

  test("legal.config_escaped", async () => {
    for (const path of PAGES) {
      const html = await (await get(path)).text();
      expect(html, path).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect(html, path).not.toContain(TITLE);
    }
  });

  test("legal.versions_exported", () => {
    const version = (name: string) => {
      const text = readFileSync(join(REPOSITORY, "apps/web/legal", name), "utf8");
      const found = /^---\nversion: (\d{4}-\d{2}-\d{2})\n---/.exec(text)?.[1];
      if (found === undefined) throw new Error(`${name} has no version`);
      expect(text.split(/^## Changes\s*$/m)[1]).toContain(found);
      return found;
    };
    expect(version("terms.en.md")).toBe(TERMS_VERSION);
    expect(version("privacy.en.md")).toBe(PRIVACY_VERSION);
  });

  test("securitytxt.fields", async () => {
    const response = await get("/.well-known/security.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const text = await response.text();
    expect(text.startsWith("# Placeholder: not reviewed by a lawyer. This file is not legal advice.\n")).toBe(true);
    expect(text).toContain(`Contact: ${ORIGIN}/legal/privacy`);
    expect(text).toContain(`Expires: ${SECURITY_TXT_EXPIRES}`);
    expect(text).toContain("Preferred-Languages: en, fr");
    expect(text).toContain(`Canonical: ${ORIGIN}/.well-known/security.txt`);
    expect(text).toContain(`Policy: ${ORIGIN}/legal/terms`);
    expect(Number.isNaN(Date.parse(SECURITY_TXT_EXPIRES))).toBe(false);
    const head = await get("/.well-known/security.txt", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  test("securitytxt.expiry_soon", () => {
    const now = Date.parse("2026-10-17T00:00:00Z");
    expect(securityTxtExpiry(stamp(now + 20 * DAY_MS), now)).toBe("soon");
    expect(securityTxtExpiry(SECURITY_TXT_EXPIRES, Date.now())).toBe("ok");
    expect(() => load({ SECURITY_TXT_EXPIRES: stamp(Date.now() + 20 * DAY_MS) })).not.toThrow();
    expect(() => load({ SECURITY_TXT_EXPIRES: stamp(Date.now() + 400 * DAY_MS) })).toThrow(ConfigError);
    expect(() => load({ SECURITY_TXT_EXPIRES: stamp(Date.now() - DAY_MS) })).toThrow(ConfigError);
    expect(() => load({ SECURITY_TXT_EXPIRES: "2027-02-31T00:00:00Z" })).toThrow(ConfigError);
    expect(() => load({ SECURITY_CONTACT: "https://evil.example/legal/privacy" })).toThrow(ConfigError);
    expect(() => load({ SECURITY_CONTACT: "https://user:pass@unset.test/legal/privacy" })).toThrow(ConfigError);
    expect(() => load({ PRIVACY_OFFICER_TITLE: "a\nb" })).toThrow(ConfigError);
  });

  test("legal.placeholders_are_the_committed_values", () => {
    const dev = readFileSync(join(REPOSITORY, "deployment/compose.dev.yaml"), "utf8");
    const local = readFileSync(join(REPOSITORY, "deployment/compose.local.yaml"), "utf8");
    const image = readFileSync(join(REPOSITORY, "deployment/images/web.test.env"), "utf8");
    for (const text of [dev, local]) {
      expect(text).toContain(`PRIVACY_OFFICER_TITLE: "${PRIVACY_OFFICER_TITLE_TOKEN}"`);
      expect(text).toContain(`PRIVACY_OFFICER_CONTACT: "${PRIVACY_OFFICER_CONTACT_TOKEN}"`);
      expect(text).toContain(`SUPPORT_EMAIL: "${SUPPORT_EMAIL_TOKEN}"`);
      expect(text).toContain(`SECURITY_CONTACT: ${SECURITY_CONTACT_PAGE}`);
      expect(text).toContain(`SECURITY_TXT_EXPIRES: "${SECURITY_TXT_EXPIRES}"`);
    }
    expect(image).toContain(`PRIVACY_OFFICER_TITLE=${PRIVACY_OFFICER_TITLE_TOKEN}`);
    expect(image).toContain(`PRIVACY_OFFICER_CONTACT=${PRIVACY_OFFICER_CONTACT_TOKEN}`);
    expect(image).toContain(`SUPPORT_EMAIL=${SUPPORT_EMAIL_TOKEN}`);
    expect(image).toContain(`SECURITY_CONTACT=${SECURITY_CONTACT_PAGE}`);
    expect(image).toContain(`SECURITY_TXT_EXPIRES=${SECURITY_TXT_EXPIRES}`);
  });
});
