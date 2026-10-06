// P1.11t: the integration setup's TE-2 conditions. A test file gets a non-superuser role and its own database, and a
// setup that fails after starting the container leaves no container behind.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, inject, test } from "vitest";
import { createPool, withClient } from "../../../infrastructure/postgres/index.ts";
import { ownContainers, stopAllPostgres } from "../../support/postgres.ts";
import { startTestDatabase } from "./pg.setup.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
// Only matters if teardown_after_failure fails: it never leaves a container running past this file.
afterAll(stopAllPostgres);

describe("integration postgres setup", () => {
  test("test_files_never_superuser", async () => {
    const provided = inject("postgres");
    expect(provided.user).not.toBe("postgres");
    const database = provided.databases[relative(REPOSITORY, import.meta.filename)];
    expect(database).toMatch(/^t_[0-9a-f]{12}$/);
    const pool = createPool({
      connection: { ...provided, database: database ?? "", ssl: false },
      service: "test",
      max: 1,
      connectTimeoutMs: 2000,
      statementTimeoutMs: 2000,
      idleInTransactionTimeoutMs: 5000,
    });
    try {
      const row = await withClient(pool, null, async (client) => {
        const { rows } = await client.query(
          "SELECT r.rolsuper, current_database() AS db, (SELECT count(*) FROM schema_migrations) AS migrations FROM pg_roles r WHERE r.rolname = current_user",
        );
        return rows[0];
      });
      expect(row).toMatchObject({ rolsuper: false, db: database });
      expect(Number(row.migrations)).toBeGreaterThan(0);
    } finally {
      await pool.close();
    }
  });

  test("teardown_after_failure", async () => {
    expect(ownContainers()).toEqual([]);
    const migrationsDir = mkdtempSync(join(tmpdir(), "unset-broken-migrations-"));
    writeFileSync(join(migrationsDir, "0001_broken.sql"), "-- phase: expand\nCREATE TABLE (;\n");
    await expect(startTestDatabase({ migrationsDir, files: [] })).rejects.toThrow(/sql_error/);
    expect(ownContainers()).toEqual([]);
  }, 120_000);
});
