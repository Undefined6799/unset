// The integration project's one Postgres (P1.11t; TE-2; ruling 2026-10-06 01:25Z). It starts the pinned image through
// tests/support/postgres.ts, runs the real migrations once as migrator into `unset`, and clones one database per test
// file from it. Test files receive a process role's connection details through Vitest's provide/inject; the superuser
// password is random per container and never leaves tests/support/postgres.ts, so no test file or log can carry it.
// Without Docker the run fails, never skips.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createLogger } from "@unset/shared-log";
import type { TestProject } from "vitest/node";
import { migrate } from "../../../infrastructure/postgres/index.ts";
import { randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const INTEGRATION = join(REPOSITORY, "tests", "integration");

/** What a test file may know: a non-superuser role and the database cloned for that file. */
export type ProvidedPostgres = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Repository-relative test file path → its own database. */
  readonly databases: Readonly<Record<string, string>>;
};

declare module "vitest" {
  interface ProvidedContext {
    postgres: ProvidedPostgres;
  }
}

export type TestDatabaseOptions = {
  readonly migrationsDir: string;
  /** Repository-relative test files that each get a database. */
  readonly files: readonly string[];
};

/** Starts Postgres, migrates the template and clones it per file. Any failure removes the container before throwing. */
export async function startTestDatabase(options: TestDatabaseOptions): Promise<ProvidedPostgres> {
  const migratorPassword = randomPassword();
  const postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  try {
    const connection = { host: "127.0.0.1", port: postgres.port, user: "migrator", password: migratorPassword };
    const result = await migrate({
      connection: { ...connection, database: "unset", ssl: false },
      dir: options.migrationsDir,
      root: REPOSITORY,
      log: createLogger({ service: "migrate", commit: "0".repeat(40), env: "test", write: () => undefined }),
      retryDelaysMs: [],
    });
    if (!result.ok) throw new Error(`test template migration failed: ${result.reason}`);
    const databases: Record<string, string> = {};
    for (const file of options.files) {
      const database = `t_${randomBytes(6).toString("hex")}`;
      postgres.sql("postgres", `CREATE DATABASE ${database} TEMPLATE unset OWNER migrator`);
      databases[file] = database;
    }
    return { ...connection, databases };
  } catch (error) {
    stopAllPostgres();
    throw error;
  }
}

/** Every integration test file, repository-relative. */
function integrationTestFiles(): string[] {
  return readdirSync(INTEGRATION, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".test.ts"))
    .map((path) => relative(REPOSITORY, join(INTEGRATION, path)))
    .sort();
}

export default async function setup(project: TestProject): Promise<() => void> {
  const provided = await startTestDatabase({
    migrationsDir: join(REPOSITORY, "infrastructure", "postgres", "migrations"),
    files: integrationTestFiles(),
  });
  project.provide("postgres", provided);
  return stopAllPostgres;
}
