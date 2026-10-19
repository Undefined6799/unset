// P1.25c (routes/test-routes.ts): the test-only pages exist only when TEST_ROUTES is on, and production refuses to
// start with it on. The routes run through the composed server, so the kit's error-page hook and headers are real.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { loadConfig } from "@unset/shared-config";
import { afterAll, describe, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import { webTestEnv } from "../test-env.ts";
import { TEST_PATHS } from "./test-routes.ts";

const ORIGIN = "https://unset.test";
const TESTDATA = fileURLToPath(new URL("../web/testdata/", import.meta.url));
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const env = (extra: Record<string, string> = {}) =>
  webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN, WEB_BUILD_DIR: TESTDATA, ...extra });

type Server = { request: (request: Request, peer?: string) => Promise<Response> };
const get = (on: Server, path: string) =>
  on.request(
    new Request(`${ORIGIN}${path}`, { headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1" } }),
    "10.0.0.1",
  );

/** The problems loading the web config with `extra` reports; empty when it loads. */
function problems(extra: Record<string, string>): { key: string; reason: string }[] {
  try {
    loadConfig(config, env(extra), { onUnknownKeys: () => undefined });
    return [];
  } catch (error) {
    return (error as { problems: { key: string; reason: string }[] }).problems;
  }
}

const UUID = /<code>([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})<\/code>/;

describe("test routes", () => {
  test("test_routes_refused_in_prod", () => {
    // Production names other keys it lacks here (net-guard hosts, a real commit); only TEST_ROUTES is this rule's.
    const refused = (extra: Record<string, string>) => problems(extra).some((p) => p.key === "TEST_ROUTES");
    expect(problems({ UNSET_ENV: "prod", TEST_ROUTES: "true" })).toContainEqual({
      key: "TEST_ROUTES",
      reason: "invalid",
    });
    expect(refused({ UNSET_ENV: "prod" })).toBe(false);
    expect(refused({ UNSET_ENV: "prod", TEST_ROUTES: "false" })).toBe(false);
    for (const unsetEnv of ["dev", "test"]) expect(refused({ UNSET_ENV: unsetEnv, TEST_ROUTES: "true" })).toBe(false);
  });

  test("test_routes_absent_by_default", async () => {
    const { server } = await compose(loadConfig(config, env()), web);
    for (const path of Object.values(TEST_PATHS)) expect((await get(server, path)).status, path).toBe(404);
  });

  test("unavailable_retry_after", async () => {
    const { server } = await compose(loadConfig(config, env({ TEST_ROUTES: "true" })), web);
    const response = await get(server, TEST_PATHS.unavailable);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).not.toBeNull();
    const html = await response.text();
    expect(html).toContain('<main id="main">');
    expect(html).toContain("service.unavailable");
    expect(html).not.toContain("<script");
  });

  test("test_app_page_is_app_group", async () => {
    const { server } = await compose(loadConfig(config, env({ TEST_ROUTES: "true" })), web);
    const response = await get(server, TEST_PATHS.app);
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain('<main id="main">');
  });

  test("test_throw_renders_server_error", async () => {
    const { server } = await compose(loadConfig(config, env({ TEST_ROUTES: "true" })), web);
    const response = await get(server, TEST_PATHS.throw);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(UUID.exec(html)?.[1]).toBeDefined();
    expect(html).not.toContain(TEST_PATHS.throw);
  });
});
