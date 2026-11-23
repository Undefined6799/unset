// The harness's two servers each start a Postgres container and remove it when they exit (fixtures/servers.ts:
// SIGTERM stops the web server, process.exit runs the exit listener that calls stopAllPostgres). Playwright 1.64.1
// SIGKILLs a webServer's process group unless gracefulShutdown is set (types/test.d.ts, TestConfigWebServer
// gracefulShutdown), and a SIGKILL runs no listener: each local e2e run left two containers behind (157 counted in
// one workspace on 2026-11-22).
import { describe, expect, test } from "vitest";
import { STOP_ALL_MS } from "../support/postgres.ts";
import config from "./playwright.config.ts";

describe("e2e servers shut down", () => {
  test("every_web_server_gets_sigterm_and_time_to_remove_its_postgres", () => {
    const servers = [config.webServer ?? []].flat();
    expect(servers.length).toBe(2);
    for (const server of servers) {
      expect(server.gracefulShutdown?.signal).toBe("SIGTERM");
      expect(server.gracefulShutdown?.timeout).toBeGreaterThanOrEqual(STOP_ALL_MS);
    }
  });
});
