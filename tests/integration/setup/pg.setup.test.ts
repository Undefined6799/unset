// P1.11t, P1.12t: the integration setup's TE-2 conditions. A test file gets the process roles (web, api, indexer, retention),
// never migrator or the superuser, and its own database; a setup that fails after starting the container leaves no
// container behind.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { createPool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, describe, expect, inject, test } from "vitest";
import { failAfterCleanup } from "../../support/docker.ts";
import { ownContainers, STOP_ALL_MS, stopAllPostgres } from "../../support/postgres.ts";
import { asAuditor, startTestDatabase } from "./pg.setup.ts";

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
  });
  try {
    return await withClient(pool, null, async (client) => (await client.query(sql)).rows[0]);
  } finally {
    await pool.end();
  }
}

/**
 * Runs `body` on a migrations folder whose one migration fails, then removes the folder whatever happened. A failing
 * removal is added to the body's failure, never put in its place (N9, P1.11f).
 */
async function withBrokenMigrations<T>(body: (migrationsDir: string) => Promise<T>): Promise<T> {
  const migrationsDir = mkdtempSync(join(tmpdir(), "unset-broken-migrations-"));
  const removeDir = () => rmSync(migrationsDir, { recursive: true, force: true });
  let result: T;
  try {
    writeFileSync(join(migrationsDir, "0001_broken.sql"), "-- phase: expand\nCREATE TABLE (;\n");
    result = await body(migrationsDir);
  } catch (failure) {
    failAfterCleanup(failure, removeDir);
  }
  removeDir();
  return result;
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

  test("auditor_is_opt_in_and_reads_the_chain_only", async () => {
    // Architecture 2026-10-19 04:51Z (P2.08g item 6): the real auditor role, reached only through asAuditor(), so a
    // test can count audit.chain. It is never one of the provided process roles, and migration 0009's grants hold:
    // SELECT on audit.chain and nothing else.
    expect(Object.keys(provided.roles)).not.toContain("auditor");
    const auditor = asAuditor(inject("postgresAuditor"), database);
    const run = (text: string) => withClient(auditor, null, (client) => client.query(text));
    try {
      expect((await run("SELECT current_user AS who")).rows[0]).toEqual({ who: "auditor" });
      expect((await run("SELECT count(*)::int AS n FROM audit.chain")).rows[0]?.n).toBeTypeOf("number");
      for (const statement of [
        "INSERT INTO audit.chain (lane) VALUES ('sec')",
        "UPDATE audit.chain SET writer = 'web'",
        "DELETE FROM audit.chain",
        "SELECT 1 FROM app.session LIMIT 1",
        "SELECT 1 FROM app.oauth_session LIMIT 1",
      ]) {
        await expect(run(statement), statement).rejects.toThrow(/permission denied/);
      }
    } finally {
      await auditor.end();
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

  test("failed_start_runs_the_teardown", async () => {
    // startPostgres ran before the try, so a start that failed skipped the teardown, and a failed globalSetup gets none
    // of its own (F1, P1.11f). A stand-in docker refuses `run`; it leaves nothing to remove.
    const standIn = mkdtempSync(join(tmpdir(), "unset-refusing-docker-"));
    writeFileSync(join(standIn, "docker"), "#!/bin/sh\necho 'no space left on device' >&2\nexit 125\n");
    chmodSync(join(standIn, "docker"), 0o755);
    const path = process.env.PATH;
    let stopped = 0;
    const failed = await withBrokenMigrations(async (migrationsDir) => {
      process.env.PATH = `${standIn}${delimiter}${path}`;
      try {
        return await startTestDatabase({ migrationsDir, files: [], stop: () => (stopped += 1) }).catch(
          (error: unknown) => error,
        );
      } finally {
        process.env.PATH = path;
        rmSync(standIn, { recursive: true, force: true });
      }
    });
    expect((failed as Error).message).toBe("docker run failed: no space left on device");
    expect(stopped).toBe(1);
  });

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
