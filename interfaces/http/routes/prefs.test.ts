// POST /prefs/theme through the composed web server, so the kit's real checks (method, media type, body limit, CSRF
// gate) run in front of the handler exactly as in production.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { loadConfig } from "@unset/shared-config";
import { afterAll, describe, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import { THEME_COOKIE } from "../prefs/theme.ts";
import { webTestEnv } from "../test-env.ts";

const ORIGIN = "https://unset.test";
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const ENV = webTestEnv(SECRETS, {
  PUBLIC_ORIGIN: ORIGIN,
  WEB_BUILD_DIR: fileURLToPath(new URL("../web/testdata/", import.meta.url)),
});
const FORM = "application/x-www-form-urlencoded";
const YEAR = "Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000";

type Send = { body?: string; type?: string; site?: "same-origin" | "cross-site"; method?: string };

async function send({ body = "", type = FORM, site = "same-origin", method = "POST" }: Send = {}) {
  const { server } = await compose(loadConfig(config, ENV), web);
  const headers = new Headers({ host: "unset.test", "x-forwarded-for": "192.0.2.1" });
  if (method === "POST") {
    headers.set("content-type", type);
    headers.set("sec-fetch-site", site);
    headers.set("origin", site === "same-origin" ? ORIGIN : "https://evil.example");
  }
  const init: RequestInit = method === "POST" ? { method, headers, body } : { method, headers };
  return server.request(new Request(`${ORIGIN}/prefs/theme`, init), "10.0.0.1");
}

describe("POST /prefs/theme", () => {
  test("prefs_theme_sets_cookie", async () => {
    const response = await send({ body: "theme=light" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBe(`${THEME_COOKIE}=light; ${YEAR}`);
  });

  test("prefs_theme_system_deletes_cookie", async () => {
    const response = await send({ body: "theme=system" });
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toBe(
      `${THEME_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  });

  test("prefs_theme_invalid_value_400", async () => {
    for (const body of ["theme=blue", "theme=%3Cscript%3E", "", "theme=light&theme=dark", "theme=Light"]) {
      const response = await send({ body });
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
      const html = await response.text();
      expect(html).toContain("prefs.invalid");
      expect(html).not.toContain("script");
    }
  });

  test("prefs_error_renders_through_kit", async () => {
    const response = await send({ body: "theme=blue" });
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain('<main id="main">');
    expect(html).toContain("<h1>That choice is not one of the options.</h1>");
    expect(html).not.toContain("blue");
  });

  test("prefs_body_too_large_413", async () => {
    const response = await send({ body: `theme=light&pad=${"x".repeat(4096)}` });
    expect(response.status).toBe(413);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("prefs_return_path_kept_when_safe", async () => {
    const response = await send({ body: "theme=dark&return=%2Fsettings%3Ftab%3D1" });
    expect(response.headers.get("location")).toBe("/settings?tab=1");
  });

  test("prefs_return_path_rejects_offsite", async () => {
    const offsite = ["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example", "/x\u0000"];
    for (const target of offsite) {
      const response = await send({ body: `theme=dark&return=${encodeURIComponent(target)}` });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
    }
  });

  test("prefs_csrf_denied", async () => {
    const response = await send({ body: "theme=light", site: "cross-site" });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  // The footer form (P1.25f) posts here from a page. A browser that sends no Sec-Fetch-Site is decided by its Origin.
  test("prefs_post_csrf_origin", async () => {
    const { server } = await compose(loadConfig(config, ENV), web);
    const post = (origin: string) =>
      server.request(
        new Request(`${ORIGIN}/prefs/theme`, {
          method: "POST",
          headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1", "content-type": FORM, origin },
          body: "theme=light&return=%2Fsigned-out",
        }),
        "10.0.0.1",
      );
    for (const origin of ["https://evil.example", "null", "http://unset.test", "https://unset.test.evil.example"]) {
      const denied = await post(origin);
      expect(denied.status).toBe(403);
      expect(denied.headers.get("set-cookie")).toBeNull();
    }
    const allowed = await post(ORIGIN);
    expect(allowed.status).toBe(303);
    expect(allowed.headers.get("location")).toBe("/signed-out");
    expect(allowed.headers.get("set-cookie")).toBe(`${THEME_COOKIE}=light; ${YEAR}`);
  });

  test("prefs_get_405", async () => {
    const response = await send({ method: "GET" });
    expect(response.status).toBe(405);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("prefs_json_415", async () => {
    for (const type of ["application/json", "multipart/form-data; boundary=x"]) {
      const response = await send({ body: '{"theme":"light"}', type });
      expect(response.status).toBe(415);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
