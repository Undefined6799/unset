import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { schema } from "./config.ts";

const PASSWORD_FILE = join(mkdtempSync(join(tmpdir(), "indexer-config-")), "pg-password");
writeFileSync(PASSWORD_FILE, "a-test-password-of-enough-bytes");

const ENV = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "indexer",
  UNSET_COMMIT: "1".repeat(40),
  LISTEN_PORT: "8081",
  PG_HOST: "postgres",
  PG_DATABASE: "unset",
  PG_USER: "indexer",
  PG_PASSWORD_FILE: PASSWORD_FILE,
  PG_SSLMODE: "disable",
  PG_POOL_MAX: "4",
  PLC_URL: "https://plc.directory",
  PDS_PUBLIC_URL: "https://pds.example.test",
  INDEXER_PDS_URL: "http://pds:3000",
};

const problems = (env: Record<string, string>): unknown => {
  try {
    loadConfig(schema, env, { onUnknownKeys: () => undefined });
    return [];
  } catch (error) {
    return error instanceof ConfigError ? error.problems : error;
  }
};

describe("indexer config", () => {
  test("config.plain_http_only_to_a_service_on_the_stack", () => {
    expect(problems(ENV)).toEqual([]);
    expect(problems({ ...ENV, INDEXER_PDS_URL: "https://pds.example.test" })).toEqual([]);
    expect(problems({ ...ENV, INDEXER_PDS_URL: "http://pds.example.test" })).toEqual([
      { key: "INDEXER_PDS_URL", reason: "invalid" },
    ]);
    expect(problems({ ...ENV, INDEXER_PDS_URL: "http://203.0.113.7:3000" })).toEqual([
      { key: "INDEXER_PDS_URL", reason: "invalid" },
    ]);
    expect(problems({ ...ENV, INDEXER_PDS_URL: "http://user:pw@pds:3000" })).toEqual([
      { key: "INDEXER_PDS_URL", reason: "invalid" },
    ]);
  });

  test("config.unhealthy_threshold_exceeds_the_streak_window", () => {
    // A 180 s restart delay ends a streak only after 2 x 180 s + 150 s = 510 s, past the 300 s default threshold.
    expect(problems({ ...ENV, INDEXER_MAX_RESTART_DELAY_MS: "180000" })).toEqual([
      { key: "INDEXER_STREAM_UNHEALTHY_MS", reason: "invalid" },
    ]);
    expect(problems({ ...ENV, INDEXER_MAX_RESTART_DELAY_MS: "180000", INDEXER_STREAM_UNHEALTHY_MS: "600000" })).toEqual(
      [],
    );
  });

  test("config.shutdown_grace_stays_under_docker_stop_grace", () => {
    expect(problems({ ...ENV, INDEXER_SHUTDOWN_GRACE_MS: "10000" })).toEqual([
      { key: "INDEXER_SHUTDOWN_GRACE_MS", reason: "invalid" },
    ]);
  });
});
