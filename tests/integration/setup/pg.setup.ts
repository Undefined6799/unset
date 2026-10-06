// The integration project's one Postgres (P1.11t; TE-2; ruling 2026-10-06 01:25Z). It starts the pinned image through
// tests/support/postgres.ts, runs the real migrations once as migrator into `unset`, and clones one database per test
// file from it. Test files receive the process roles' connection details (web, api, indexer; P1.12t, TE-2) through
// Vitest's provide/inject, never migrator's; the superuser password is random per container and never leaves
// tests/support/postgres.ts, so no test file or log can carry it.
// Without Docker the run fails, never skips.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createLogger } from "@unset/shared-log";
import type { TestProject } from "vitest/node";
import { createPool, migrate, type PoolClient, withClient } from "../../../infrastructure/postgres/index.ts";
import { randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const INTEGRATION = join(REPOSITORY, "tests", "integration");

/** The roles a test file connects as: the processes' own (ruling 2026-10-06 03:15Z (a)). `retention` is the jobs
 * process's role, which P1.16's sweep test connects as (architecture record 2026-10-06 p116-retention-usage). */
export const PROCESS_ROLES = ["web", "api", "indexer", "retention"] as const;
export type ProcessRole = (typeof PROCESS_ROLES)[number];

/** What a test file may know: the process roles and the database cloned for that file. */
export type ProvidedPostgres = {
  readonly host: string;
  readonly port: number;
  readonly roles: Readonly<Record<ProcessRole, { readonly user: ProcessRole; readonly password: string }>>;
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
    const roles = await asMigrator(connection, (client) => prepareRoles(client, Object.values(databases)));
    return { host: connection.host, port: connection.port, roles, databases };
  } catch (error) {
    stopAllPostgres();
    throw error;
  }
}

type MigratorConnection = { host: string; port: number; user: string; password: string };

async function asMigrator<T>(connection: MigratorConnection, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = createPool({
    connection: { ...connection, database: "unset", ssl: false },
    service: "test-setup",
    max: 1,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 10_000,
    idleInTransactionTimeoutMs: 10_000,
  });
  try {
    return await withClient(pool, null, fn);
  } finally {
    await pool.close();
  }
}

/**
 * Gives each process role a password for this run, as migrator, which administers the roles it created (P1.12p does
 * the same from secret files). A clone starts with the default database ACL, so each gets `unset`'s: PUBLIC revoked,
 * CONNECT for the roles migration 0003 granted it.
 */
async function prepareRoles(client: PoolClient, clones: readonly string[]): Promise<ProvidedPostgres["roles"]> {
  const { rows } = await client.query<{ role: string }>(
    "SELECT a.grantee::regrole::text AS role FROM pg_catalog.pg_database d, pg_catalog.aclexplode(d.datacl) a " +
      "WHERE d.datname = 'unset' AND a.privilege_type = 'CONNECT' AND a.grantee <> d.datdba",
  );
  for (const clone of clones) {
    await client.query(`REVOKE ALL ON DATABASE ${clone} FROM PUBLIC`);
    for (const { role } of rows) await client.query(`GRANT CONNECT ON DATABASE ${clone} TO ${role}`);
  }
  const entries = [];
  for (const user of PROCESS_ROLES) {
    const password = randomBytes(24).toString("hex");
    await client.query(`ALTER ROLE ${user} PASSWORD '${password}'`);
    entries.push([user, { user, password }] as const);
  }
  return Object.fromEntries(entries) as ProvidedPostgres["roles"];
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
