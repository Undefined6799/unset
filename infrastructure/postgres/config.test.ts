// P1.11: the Postgres connection settings, read through the migrate CLI schema, and the sslmode mapping. P1.11p: the
// pool fields and the private CA file.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, defineConfig, loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { connectionOf, lockPoolFields, poolFields, postgresFields } from "./config.ts";
import { migrateConfig } from "./migrate-cli.ts";

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
    expect(() => load({ PG_HOST: "db.example.org", PG_SSLMODE: "require" })).toThrow(ConfigError);
  });

  test("migrate_config_refuses_bad_values", () => {
    expect(() => load({ PG_USER: "Migrator; DROP" })).toThrow(ConfigError);
    expect(() => load({ PG_HOST: "postgres:5432" })).toThrow(ConfigError);
    expect(() => load({ PG_SSLMODE: "prefer" })).toThrow(ConfigError);
    expect(() => load({ PG_PASSWORD_FILE: join(tmpdir(), "no-such-unset-secret") })).toThrow(ConfigError);
  });
});

const poolConfig = defineConfig({ ...postgresFields, ...poolFields });
const loadPool = (overrides: Record<string, string> = {}) =>
  loadConfig(poolConfig, env({ PG_POOL_MAX: "10", ...overrides }), { onUnknownKeys: () => undefined });

describe("pool config", () => {
  test("pool_config_defaults_and_ranges", () => {
    const cfg = loadPool();
    expect([cfg.PG_POOL_MAX, cfg.PG_CONNECT_TIMEOUT_MS, cfg.PG_MAX_REPLICAS]).toEqual([10, 2000, 3]);
    // 0 is node-postgres's "wait forever".
    expect(() => loadPool({ PG_CONNECT_TIMEOUT_MS: "0" })).toThrow(ConfigError);
    expect(() => loadPool({ PG_POOL_MAX: "0" })).toThrow(ConfigError);
    expect(() => loadPool({ PG_POOL_MAX: "51" })).toThrow(ConfigError);
    expect(() => loadPool({ PG_MAX_REPLICAS: "5" })).toThrow(ConfigError);
    expect(() => loadConfig(poolConfig, env(), { onUnknownKeys: () => undefined })).toThrow(ConfigError);
  });

  test("lock_pool_max_default_and_range", () => {
    const lockConfig = defineConfig({ ...postgresFields, ...lockPoolFields });
    const loadLock = (overrides: Record<string, string> = {}) =>
      loadConfig(lockConfig, env(overrides), { onUnknownKeys: () => undefined });
    expect(loadLock().LOCK_POOL_MAX).toBe(8);
    expect(loadLock({ LOCK_POOL_MAX: "2" }).LOCK_POOL_MAX).toBe(2);
    expect(() => loadLock({ LOCK_POOL_MAX: "0" })).toThrow(ConfigError);
    expect(() => loadLock({ LOCK_POOL_MAX: "21" })).toThrow(ConfigError);
  });

  test("sslmode_disable_refused_for_dotted_or_ip_host", () => {
    for (const host of ["db.example.org", "10.0.0.5", "203.0.113.7", "postgres.internal", "db.local", "1postgres"]) {
      expect(() => loadPool({ PG_HOST: host })).toThrow(ConfigError);
    }
    expect(loadPool({ PG_HOST: "postgres" }).PG_SSLMODE).toBe("disable");
    expect(loadPool({ PG_HOST: "127.0.0.1" }).PG_SSLMODE).toBe("disable");
  });

  test("sslmode_disable_refused_for_ipv6_literal", () => {
    for (const host of ["2001:db8::1", "[2001:db8::1]", "::ffff:203.0.113.7"]) {
      expect(() => loadPool({ PG_HOST: host })).toThrow(ConfigError);
    }
  });

  test("sslrootcert_passed_as_ca", () => {
    const caFile = join(mkdtempSync(join(tmpdir(), "unset-pg-ca-")), "ca.pem");
    writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
    const cfg = loadPool({ PG_HOST: "db.example.org", PG_SSLMODE: "verify-full", PG_SSLROOTCERT: caFile });
    expect(connectionOf(cfg).ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n" });
    // A CA file only means something with the checks on.
    expect(() => loadPool({ PG_SSLROOTCERT: caFile })).toThrow(ConfigError);
    expect(() => loadPool({ PG_SSLMODE: "verify-full", PG_SSLROOTCERT: "relative/ca.pem" })).toThrow(ConfigError);
  });
});
