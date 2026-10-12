// P1.11t, P1.12t: the integration setup's TE-2 conditions. A test file gets the process roles (web, api, indexer, retention),
// never migrator or the superuser, and its own database; a setup that fails after starting the container leaves no
// container behind.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, inject, test } from "vitest";
import { createPool, withClient } from "../../../infrastructure/postgres/index.ts";
import { ownContainers, STOP_ALL_MS, stopAllPostgres } from "../../support/postgres.ts";
import { startTestDatabase } from "./pg.setup.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
// Only matters if teardown_after_failure fails: it never leaves a container running past this file.
afterAll(stopAllPostgres, STOP_ALL_MS);

const provided = inject("postgres");
const database = provided.databases[relative(REPOSITORY, import.meta.filename)] ?? "";

/** The one row `sql` returns in this file's database, connected as `role`. */
async function asRole(role: { user: string; password: string }, sql: string): Promise<Record<string, unknown>> {
  const pool = createPool({
    connection: { host: provided.host, port: provided.port, ...role, database, ssl: false },
    service: "test",
    max: 1,
    connectTimeoutMs: 2000,
    statementTimeoutMs: 2000,
    idleInTransactionTimeoutMs: 5000,
  });
  try {
    return await withClient(pool, null, async (client) => (await client.query(sql)).rows[0]);
  } finally {
    await pool.close();
  }
}

/** Runs `body` on a migrations folder whose one migration fails, then removes the folder whatever happened. */
async function withBrokenMigrations<T>(body: (migrationsDir: string) => Promise<T>): Promise<T> {
  const migrationsDir = mkdtempSync(join(tmpdir(), "unset-broken-migrations-"));
  try {
    writeFileSync(join(migrationsDir, "0001_broken.sql"), "-- phase: expand\nCREATE TABLE (;\n");
    return await body(migrationsDir);
  } finally {
    rmSync(migrationsDir, { recursive: true, force: true });
  }
}

describe("integration postgres setup", () => {
  test("test_files_connect_as_process_role", async () => {
    // Ruling 2026-10-06 03:15Z (a): what a test file receives names only the process roles, and each connects as itself.
    expect(Object.keys(provided).sort()).toEqual(["databases", "host", "port", "roles"]);
    expect(Object.keys(provided.roles).sort()).toEqual(["api", "indexer", "retention", "web"]);
    for (const [name, role] of Object.entries(provided.roles)) {
      const row = await asRole(
        role,
        "SELECT current_user AS who, r.rolsuper FROM pg_roles r WHERE r.rolname = current_user",
      );
      expect(row).toEqual({ who: name, rolsuper: false });
    }
  });

  test("test_files_never_superuser", async () => {
    expect(database).toMatch(/^t_[0-9a-f]{12}$/);
    const row = await asRole(
      provided.roles.web,
      "SELECT r.rolsuper, current_database() AS db, to_regnamespace('app') IS NOT NULL AS migrated " +
        "FROM pg_roles r WHERE r.rolname = current_user",
    );
    expect(row).toEqual({ rolsuper: false, db: database, migrated: true });
  });

  test("teardown_after_failure", async () => {
    expect(ownContainers()).toEqual([]);
    await withBrokenMigrations(async (migrationsDir) => {
      await expect(startTestDatabase({ migrationsDir, files: [] })).rejects.toThrow(/sql_error/);
    });
    expect(ownContainers()).toEqual([]);
  }, 120_000);

  test("failing_teardown_keeps_the_setup_error", async () => {
    // pg.setup.ts's catch reports a failed removal with the setup error, never in its place (P1.11c, N1 on #706).
    const stop = () => {
      stopAllPostgres();
      throw new Error("docker rm killed after 55000 ms");
    };
    const failed = await withBrokenMigrations((migrationsDir) =>
      startTestDatabase({ migrationsDir, files: [], stop }).catch((error: unknown) => error),
    );
    expect(failed).toBeInstanceOf(AggregateError);
    expect((failed as AggregateError).message).toMatch(/sql_error \(cleanup also failed: docker rm killed/);
    expect(ownContainers()).toEqual([]);
  }, 120_000);
});
