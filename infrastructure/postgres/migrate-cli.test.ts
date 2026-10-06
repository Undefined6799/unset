// P1.11: the migrate CLI's configuration and how it maps sslmode onto the driver.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { connectionOf, migrateConfig } from "./migrate-cli.ts";

const passwordFile = join(mkdtempSync(join(tmpdir(), "unset-migrate-cli-")), "pg_migrator_password");
writeFileSync(passwordFile, "a-test-password-of-enough-bytes\n");

const env = (overrides: Record<string, string> = {}) => ({
  UNSET_ENV: "test",
  UNSET_COMMIT: "0".repeat(40),
  PG_HOST: "postgres",
  PG_DATABASE: "unset",
  PG_USER: "migrator",
  PG_PASSWORD_FILE: passwordFile,
  PG_SSLMODE: "disable",
  ...overrides,
});
const load = (overrides?: Record<string, string>) =>
  loadConfig(migrateConfig, env(overrides), { onUnknownKeys: () => undefined });

describe("migrate CLI config", () => {
  test("migrate_config_reads_the_password_file", () => {
    const cfg = load();
    expect(cfg.PG_PORT).toBe(5432);
    expect(String(cfg.PG_PASSWORD)).toBe("[secret]");
    expect(connectionOf(cfg)).toEqual({
      host: "postgres",
      port: 5432,
      database: "unset",
      user: "migrator",
      password: "a-test-password-of-enough-bytes",
      ssl: false,
    });
  });

  test("migrate_config_plain_tcp_only_inside_compose", () => {
    expect(() => load({ PG_HOST: "db.example.org" })).toThrow(ConfigError);
    expect(connectionOf(load({ PG_HOST: "db.example.org", PG_SSLMODE: "verify-full" })).ssl).toBe(true);
    expect(connectionOf(load({ PG_HOST: "db.example.org", PG_SSLMODE: "require" })).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  test("migrate_config_refuses_bad_values", () => {
    expect(() => load({ PG_USER: "Migrator; DROP" })).toThrow(ConfigError);
    expect(() => load({ PG_HOST: "postgres:5432" })).toThrow(ConfigError);
    expect(() => load({ PG_SSLMODE: "prefer" })).toThrow(ConfigError);
    expect(() => load({ PG_PASSWORD_FILE: join(tmpdir(), "no-such-unset-secret") })).toThrow(ConfigError);
  });
});
