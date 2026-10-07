#!/usr/bin/env node
// `unset-migrate` (P1.11): the one-shot Compose `migrate` service, holding only the `migrator` credentials. It applies
// the migrations, then sets the roster roles' passwords from their secret files (`migrateThenSyncPasswords`; wired by
// P1.29k as the P1.12x binding requires), never the passwords when a migration fails. Exit 0 ok, 1 error, 2 an applied
// migration was edited, 3 a gap in the versions; a configuration problem exits 78 (bootOrExit).
import { join } from "node:path";
import { bootOrExit, defineConfig, oneOf, str } from "@unset/shared-config";
import { createLogger } from "@unset/shared-log";
import { connectionOf, postgresFields } from "./config.ts";
import { type MigrateServiceResult, migrateThenSyncPasswords } from "./migrate.ts";

/**
 * Where Compose mounts secrets. A constant, not configuration: an environment change must not point the password
 * reader at another folder (architecture record 2026-10-07-p129-migrate-image-and-run-only-images, amendment point 1).
 */
export const ROLE_PASSWORDS_DIR = "/run/secrets";

export const migrateConfig = defineConfig({
  UNSET_ENV: oneOf(["dev", "test", "prod"]),
  UNSET_COMMIT: str({ pattern: /[0-9a-f]{40}/ }),
  ...postgresFields,
});

/** One line naming the step, the fixed reason, and the migration file and line or the roster role; never a secret. */
function describe(result: Exclude<MigrateServiceResult, { ok: true }>): string {
  if (result.step === "passwords") {
    const { reason, role, sqlstate } = result.failure;
    return `unset-migrate: password sync ${reason}${role ? ` for ${role}` : ""}${sqlstate ? ` (${sqlstate})` : ""}\n`;
  }
  const { reason, file, line } = result.failure;
  return `unset-migrate: ${reason}${file ? ` in ${file}` : ""}${line ? ` line ${line}` : ""}\n`;
}

if (import.meta.main) {
  const cfg = bootOrExit(migrateConfig);
  const log = createLogger({ service: "migrate", commit: cfg.UNSET_COMMIT, env: cfg.UNSET_ENV });
  const result = await migrateThenSyncPasswords({
    connection: connectionOf(cfg),
    dir: join(import.meta.dirname, "migrations"),
    root: join(import.meta.dirname, "..", ".."),
    log,
    secretsDir: ROLE_PASSWORDS_DIR,
  });
  if (!result.ok) process.stderr.write(describe(result));
  process.exitCode = result.ok ? 0 : result.step === "migrate" ? result.failure.exit : 1;
}
