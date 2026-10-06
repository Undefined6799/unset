#!/usr/bin/env node
// `unset-migrate` (P1.11): the one-shot Compose `migrate` service, holding only the `migrator` credentials. Exit 0 ok,
// 1 error, 2 an applied migration was edited, 3 a gap in the versions; a configuration problem exits 78 (bootOrExit).
import { join } from "node:path";
import { bootOrExit, defineConfig, int, oneOf, secretFile, str, withRule } from "@unset/shared-config";
import { createLogger } from "@unset/shared-log";
import { type Connection, type MigrateFailure, migrate } from "./migrate.ts";

/** A lowercase hostname or a Compose service name; no scheme, port or trailing dot. */
const HOSTNAME = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*/;
/** An unquoted Postgres identifier. */
const IDENTIFIER = /[a-z_][a-z0-9_]{0,62}/;

export const migrateConfig = defineConfig({
  UNSET_ENV: oneOf(["dev", "test", "prod"]),
  UNSET_COMMIT: str({ pattern: /[0-9a-f]{40}/ }),
  PG_HOST: str({ pattern: HOSTNAME }),
  PG_PORT: int({ min: 1, max: 65535, default: 5432 }),
  PG_DATABASE: str({ pattern: IDENTIFIER }),
  PG_USER: str({ pattern: IDENTIFIER }),
  PG_PASSWORD: secretFile({ minBytes: 16 }),
  // Plain TCP only inside the Compose network, where a service name has no dot; anything else is encrypted.
  PG_SSLMODE: withRule(
    oneOf(["disable", "require", "verify-full"]),
    (config) => config.PG_SSLMODE !== "disable" || !String(config.PG_HOST).includes("."),
  ),
});

type MigrateConfig = ReturnType<typeof bootOrExit<typeof migrateConfig.fields>>;

/** libpq's sslmode in node-postgres terms: `require` encrypts without checking the certificate, as libpq does. */
export function connectionOf(cfg: MigrateConfig): Connection {
  const ssl = { disable: false, require: { rejectUnauthorized: false }, "verify-full": true }[cfg.PG_SSLMODE];
  return {
    host: cfg.PG_HOST,
    port: cfg.PG_PORT,
    database: cfg.PG_DATABASE,
    user: cfg.PG_USER,
    password: cfg.PG_PASSWORD.reveal(),
    ssl,
  };
}

/** One line naming the file and line of a refused migration: repository file names and fixed words only. */
const describe = (f: MigrateFailure): string =>
  `unset-migrate: ${f.reason}${f.file ? ` in ${f.file}` : ""}${f.line ? ` line ${f.line}` : ""}\n`;

if (import.meta.main) {
  const cfg = bootOrExit(migrateConfig);
  const log = createLogger({ service: "migrate", commit: cfg.UNSET_COMMIT, env: cfg.UNSET_ENV });
  const result = await migrate({
    connection: connectionOf(cfg),
    dir: join(import.meta.dirname, "migrations"),
    root: join(import.meta.dirname, "..", ".."),
    log,
  });
  if (!result.ok) process.stderr.write(describe(result));
  process.exitCode = result.ok ? 0 : result.exit;
}
