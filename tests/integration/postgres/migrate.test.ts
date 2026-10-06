// P1.11 (infrastructure/postgres/migrate.ts): the runner against the real image, booted with P1.11g's bootstrap
// through the one test helper. Each test gets its own database owned by migrator and its own migrations folder; the
// runner connects as migrator over TCP. It lives here, not beside migrate.ts, because a workspace may not reference
// the tests project (scripts/workspace/references.ts).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type MigrateOptions, migrate } from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const initDir = join(import.meta.dirname, "..", "..", "..", "deployment", "postgres", "init");
const migratorPassword = randomPassword();
let postgres: PostgresContainer;
let databases = 0;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir,
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
}, 120_000);
afterAll(stopAllPostgres);

/** A fresh database owned by migrator, an empty migrations folder, and the log lines the run writes. */
function setup(user = "migrator", password = migratorPassword) {
  databases += 1;
  const database = `t_${databases}`;
  postgres.sql("postgres", `CREATE DATABASE ${database} OWNER migrator`);
  const dir = mkdtempSync(join(tmpdir(), "unset-migrations-"));
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "migrate",
    commit: "0".repeat(40),
    env: "test",
    write: (line) => lines.push(JSON.parse(line)),
  });
  const options: MigrateOptions = {
    connection: { host: "127.0.0.1", port: postgres.port, database, user, password, ssl: false },
    dir,
    root: dir,
    log,
    retryDelaysMs: [],
  };
  const write = (file: string, sql: string) => writeFileSync(join(dir, file), sql);
  const remove = (file: string) => rmSync(join(dir, file));
  const query = (sql: string) => postgres.sql(database, sql);
  const events = () => lines.map((line) => line.event);
  return { options, write, remove, query, lines, events };
}

const TABLE_A = "-- phase: expand\nCREATE TABLE a (id int PRIMARY KEY);\n";
const TABLE_B = "-- phase: expand\nCREATE TABLE b (id int PRIMARY KEY);\n";

describe("migrate", () => {
  test("applies_in_order", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    t.write("0002_b.sql", "-- phase: expand\nCREATE TABLE b (a int REFERENCES a (id));\n");
    expect(await migrate(t.options)).toEqual({ ok: true, applied: [1, 2], ahead: [] });
    expect(t.query("SELECT version, name, length(checksum), phase FROM schema_migrations ORDER BY 1")).toBe(
      "1|0001_a.sql|64|expand\n2|0002_b.sql|64|expand",
    );
    expect(t.lines.at(-1)).toMatchObject({ event: "migrate.done", count: 2 });
  });

  test("applies_the_repository_migrations", async () => {
    const t = setup();
    const repository = join(import.meta.dirname, "..", "..", "..");
    const options = {
      ...t.options,
      dir: join(repository, "infrastructure", "postgres", "migrations"),
      root: repository,
    };
    const first = await migrate(options);
    expect(first.ok && first.applied[0]).toBe(1);
    expect(await migrate(options)).toEqual({ ok: true, applied: [], ahead: [] });
  });

  test("idempotent_rerun", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    await migrate(t.options);
    expect(await migrate(t.options)).toEqual({ ok: true, applied: [], ahead: [] });
    expect(t.query("SELECT count(*) FROM schema_migrations")).toBe("1");
  });

  test("checksum_mismatch_exit_2", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    await migrate(t.options);
    t.write("0001_a.sql", `${TABLE_A}-- edited\n`);
    t.write("0002_b.sql", TABLE_B);
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 2, reason: "checksum_mismatch", version: 1 });
    expect(t.query("SELECT count(*) FROM schema_migrations")).toBe("1");
    expect(t.query("SELECT to_regclass('b') IS NULL")).toBe("t");
  });

  test("gap_exit_3", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    t.write("0003_b.sql", TABLE_B);
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 3, reason: "gap" });
    t.remove("0003_b.sql");
    t.write("0001_b.sql", TABLE_B);
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 1, reason: "duplicate_version" });
    t.remove("0001_b.sql");
    t.write("1_b.sql", TABLE_B);
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 1, reason: "bad_file_name" });
  });

  test("database_ahead_exit_0", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    t.write("0002_b.sql", TABLE_B);
    t.write("0003_c.sql", "-- phase: expand\nCREATE TABLE c (id int);\n");
    await migrate(t.options);
    t.remove("0003_c.sql");
    t.remove("0002_b.sql");
    t.write("0002_b.sql", TABLE_B);
    expect(await migrate(t.options)).toEqual({ ok: true, applied: [], ahead: [3] });
    expect(t.lines.at(-1)).toMatchObject({ event: "migrate.database_ahead", count: 1, version: 3 });
  });

  test("failing_migration_rolls_back", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    t.write("0002_b.sql", "-- phase: expand\nCREATE TABLE b (id int);\nSELEC 1;\n");
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 1, reason: "sql_error", version: 2 });
    expect(t.query("SELECT version FROM schema_migrations")).toBe("1");
    expect(t.query("SELECT to_regclass('b') IS NULL")).toBe("t");
    // The log carries the SQLSTATE (42601 syntax_error), never the driver's message.
    expect(t.lines.at(-1)).toEqual(
      expect.objectContaining({ event: "migrate.failed", reason: "sql_error", version: 2, sqlstate: "42601" }),
    );
    expect(JSON.stringify(t.lines)).not.toContain("SELEC");
  });

  test("no_transaction_file_runs_alone", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    const concurrently =
      "-- query: 0001_a.sql\n-- why: speed\nCREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON a (id);";
    t.write("0002_idx.sql", `-- phase: expand\n-- unset: no-transaction\n${concurrently}\n`);
    expect(await migrate(t.options)).toEqual({ ok: true, applied: [1, 2], ahead: [] });
    expect(t.query("SELECT indexname FROM pg_indexes WHERE indexname = 'a_idx'")).toBe("a_idx");
  });

  test("concurrent_runners", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    t.write("0002_b.sql", "-- phase: expand\nCREATE TABLE b (id int);\nSELECT pg_sleep(0.5);\n");
    const results = await Promise.all([migrate(t.options), migrate(t.options)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.flatMap((r) => (r.ok ? r.applied : [])).sort()).toEqual([1, 2]);
    expect(t.query("SELECT count(*) FROM schema_migrations")).toBe("2");
  });

  test("another_runner_holds_the_lock", async () => {
    const t = setup();
    t.write("0001_slow.sql", "-- phase: expand\nSELECT pg_sleep(2);\n");
    const first = migrate(t.options);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await migrate({ ...t.options, lockWaitMs: 600 })).toMatchObject({ ok: false, reason: "lock_timeout" });
    expect(await first).toMatchObject({ ok: true, applied: [1] });
  });

  test("expand_lint", async () => {
    const t = setup();
    t.write("0001_a.sql", "-- phase: expand\nCREATE TABLE x (y int, z int);\n");
    t.write("0002_drop.sql", "-- phase: expand\n\nALTER TABLE x DROP COLUMN y;\n");
    expect(await migrate(t.options)).toMatchObject({
      ok: false,
      exit: 1,
      reason: "lint_drop",
      file: "0002_drop.sql",
      line: 3,
    });
    expect(t.query("SELECT to_regclass('schema_migrations') IS NULL")).toBe("t");
    t.write("0002_drop.sql", "-- phase: contract\n\nALTER TABLE x DROP COLUMN y;\n");
    expect(await migrate(t.options)).toMatchObject({ ok: true, applied: [1, 2] });
    t.write("0003_none.sql", "CREATE TABLE w (id int);\n");
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 1, reason: "no_phase_header", line: 1 });
  });

  test("index_needs_query_comment", async () => {
    const t = setup();
    t.write("0001_a.sql", `${TABLE_A}CREATE INDEX a_idx ON a (id);\n`);
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 1, reason: "lint_index_comment", line: 3 });
    t.write("0001_a.sql", `${TABLE_A}-- query: missing.ts\n-- why: speed\nCREATE INDEX a_idx ON a (id);\n`);
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 1, reason: "lint_index_query_file", line: 5 });
    t.write("0001_a.sql", `${TABLE_A}-- query: 0001_a.sql\n-- why: speed\nCREATE INDEX a_idx ON a (id);\n`);
    expect(await migrate(t.options)).toMatchObject({ ok: true, applied: [1] });
  });

  test("must_be_migrator", async () => {
    const password = randomPassword();
    postgres.sql("postgres", `CREATE ROLE other LOGIN PASSWORD '${password}'`);
    const t = setup("other", password);
    postgres.sql("postgres", `GRANT CONNECT ON DATABASE t_${databases} TO other`);
    t.write("0001_a.sql", TABLE_A);
    expect(await migrate(t.options)).toMatchObject({ ok: false, exit: 1, reason: "not_migrator" });
    expect(t.query("SELECT to_regclass('a') IS NULL")).toBe("t");
  });

  test("unreachable_database_exit_1", async () => {
    const t = setup();
    t.write("0001_a.sql", TABLE_A);
    const closed = { ...t.options.connection, port: 1 };
    const started = Date.now();
    const result = await migrate({ ...t.options, connection: closed, retryDelaysMs: [50, 100] });
    expect(result).toMatchObject({ ok: false, exit: 1, reason: "connect_failed" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    // A wrong password is a refusal from a running server: no retry.
    const refused = { ...t.options.connection, password: "wrong" };
    expect(await migrate({ ...t.options, connection: refused, retryDelaysMs: [60_000] })).toMatchObject({
      ok: false,
      reason: "connect_failed",
    });
  });

  test("scram_only", () => {
    expect(postgres.sql("postgres", "SHOW password_encryption")).toBe("scram-sha-256");
    expect(
      postgres.sql("postgres", "SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolname = 'migrator'"),
    ).toBe("t");
  });
});
