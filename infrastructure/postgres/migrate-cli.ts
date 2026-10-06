#!/usr/bin/env node
// `unset-migrate` (P1.11): the one-shot Compose `migrate` service, holding only the `migrator` credentials. Exit 0 ok,
// 1 error, 2 an applied migration was edited, 3 a gap in the versions; a configuration problem exits 78 (bootOrExit).
import { join } from "node:path";
import { bootOrExit, defineConfig, oneOf, str } from "@unset/shared-config";
import { createLogger } from "@unset/shared-log";
import { connectionOf, postgresFields } from "./config.ts";
import { type MigrateFailure, migrate } from "./migrate.ts";

export const migrateConfig = defineConfig({
  UNSET_ENV: oneOf(["dev", "test", "prod"]),
  UNSET_COMMIT: str({ pattern: /[0-9a-f]{40}/ }),
  ...postgresFields,
});

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
