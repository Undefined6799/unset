// P3.06g (infrastructure/postgres/migrations/0027_indexer_end_sessions.sql), P3.07s (0028, idx.is_erased) and P3.06e
// (0029, idx.erase_deleted_account, which reaches core.erase_did with no grant in core): the
// indexer may end a DID's sessions
// through app.end_sessions_for_did and do nothing else in schema `app`. USAGE on a schema reaches every function in it
// that PUBLIC may execute, so the test lists what `indexer` can execute, read or write there, as the real role (TE-2).
import { relative } from "node:path";
import { createPool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const indexer = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.indexer, database, ssl: false },
  service: "indexer-app-access-test",
  max: 1,
  connectTimeoutMs: 2000,
});
afterAll(() => indexer.end());

const names = (sql: string) =>
  withClient(indexer, null, async (db) => (await db.query<{ name: string }>(sql)).rows.map((row) => row.name));

describe("indexer in schema app", () => {
  test("indexer_executes_only_end_sessions_for_did", async () => {
    expect(
      await names(
        "SELECT p.proname AS name FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'app'::regnamespace " +
          "AND has_function_privilege(p.oid, 'EXECUTE') ORDER BY 1",
      ),
    ).toEqual(["end_sessions_for_did"]);
  });

  test("indexer_reads_and_writes_no_app_relation", async () => {
    expect(
      await names(
        "SELECT c.relname AS name FROM pg_catalog.pg_class c WHERE c.relnamespace = 'app'::regnamespace " +
          "AND (has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') " +
          "OR has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') " +
          "OR (c.relkind = 'S' AND has_sequence_privilege(c.oid, 'USAGE, SELECT, UPDATE'))) ORDER BY 1",
      ),
    ).toEqual([]);
  });

  test("indexer_ends_a_dids_sessions", async () => {
    const ended = await withClient(indexer, null, async (db) => {
      const { rows } = await db.query<{ ended: number }>("SELECT app.end_sessions_for_did($1, $2) AS ended", [
        `did:plc:${"e".repeat(24)}`,
        "deactivated",
      ]);
      return rows[0]?.ended;
    });
    expect(ended).toBe(0);
  });
});

describe("indexer in schemas idx and core", () => {
  test("indexer_executes_only_is_erased_and_erase_deleted_account_in_idx", async () => {
    // No function in idx is executable by PUBLIC (0003), so this list is exactly the grants made to indexer.
    expect(
      await names(
        "SELECT p.proname AS name FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'idx'::regnamespace " +
          "AND has_function_privilege(p.oid, 'EXECUTE') ORDER BY 1",
      ),
    ).toEqual(["erase_deleted_account", "is_erased"]);
  });

  test("indexer_reaches_nothing_in_core", async () => {
    expect(
      await names(
        "SELECT 'usage' AS name WHERE has_schema_privilege('core', 'USAGE') UNION ALL " +
          "SELECT p.proname FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'core'::regnamespace " +
          "AND has_function_privilege(p.oid, 'EXECUTE') UNION ALL " +
          "SELECT c.relname FROM pg_catalog.pg_class c WHERE c.relnamespace = 'core'::regnamespace " +
          "AND (has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') " +
          "OR has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))",
      ),
    ).toEqual([]);
  });

  test("indexer_asks_whether_a_did_was_erased", async () => {
    const answer = await withClient(indexer, null, async (db) => {
      const { rows } = await db.query<{ erased: boolean }>("SELECT idx.is_erased($1) AS erased", [
        `did:plc:${"f".repeat(24)}`,
      ]);
      return rows[0]?.erased;
    });
    expect(answer).toBe(false);
  });
});
