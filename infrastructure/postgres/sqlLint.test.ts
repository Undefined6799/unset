// P1.11: what an expand migration may not do, and the index comment rule, read from SQL text.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { lintMigration } from "./sqlLint.ts";

const root = mkdtempSync(join(tmpdir(), "unset-sqllint-"));
mkdirSync(join(root, "domains", "x"), { recursive: true });
writeFileSync(join(root, "domains", "x", "repo.ts"), "export {};\n");

const expand = (sql: string) => lintMigration(`-- phase: expand\n${sql}`, "expand", root);
const contract = (sql: string) => lintMigration(`-- phase: contract\n${sql}`, "contract", root);

describe("expand lint", () => {
  test("expand_lint_refuses_breaking_changes", () => {
    expect(expand("ALTER TABLE x DROP COLUMN y;")).toEqual([{ line: 2, rule: "drop" }]);
    expect(expand("ALTER TABLE x DROP y;")).toEqual([{ line: 2, rule: "drop" }]);
    expect(expand("DROP TABLE x;")).toEqual([{ line: 2, rule: "drop" }]);
    expect(expand("drop schema s cascade;")).toEqual([{ line: 2, rule: "drop" }]);
    expect(expand("DROP INDEX x_idx;")).toEqual([{ line: 2, rule: "drop" }]);
    expect(expand("ALTER TABLE x RENAME TO z;")).toEqual([{ line: 2, rule: "rename" }]);
    expect(expand("ALTER TABLE x\n  ALTER COLUMN y TYPE bigint;")).toEqual([{ line: 3, rule: "alter_type" }]);
    expect(expand("ALTER TABLE x ALTER COLUMN y SET DATA TYPE text;")).toEqual([{ line: 2, rule: "alter_type" }]);
    expect(expand("SELECT 1;\nALTER TABLE x ALTER COLUMN y SET NOT NULL;")).toEqual([
      { line: 3, rule: "set_not_null" },
    ]);
    expect(expand("TRUNCATE x;")).toEqual([{ line: 2, rule: "truncate" }]);
  });

  test("expand_lint_allows_additions", () => {
    expect(expand("CREATE TABLE x (id int PRIMARY KEY);\nALTER TABLE x ADD COLUMN y text;")).toEqual([]);
    expect(expand("ALTER TABLE x ALTER COLUMN y DROP NOT NULL;")).toEqual([]);
    expect(expand("ALTER TABLE x DROP CONSTRAINT x_check;\nALTER TABLE x ALTER COLUMN y DROP DEFAULT;")).toEqual([]);
    expect(expand("-- DROP TABLE x is only a comment\nSELECT 1;")).toEqual([]);
  });

  test("expand_lint_allows_dropping_its_own_index", () => {
    const own = "-- query: domains/x/repo.ts\n-- why: speed\nCREATE INDEX CONCURRENTLY IF NOT EXISTS x_idx ON x (y);";
    expect(expand(`DROP INDEX CONCURRENTLY IF EXISTS x_idx;\n${own}`)).toEqual([]);
    expect(expand(`DROP INDEX CONCURRENTLY IF EXISTS other_idx;\n${own}`)).toEqual([{ line: 2, rule: "drop" }]);
    expect(expand(`DROP INDEX x_idx;\n${own}`)).toEqual([{ line: 2, rule: "drop" }]);
  });

  // P1.15x (architecture ruling 2026-10-06 23:10Z): TRUNCATE as a trigger event is protective, not a statement.
  test("trigger_event_list_allowed", () => {
    const trigger =
      "CREATE TRIGGER chain_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.chain " +
      "FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();";
    expect(expand(trigger)).toEqual([]);
    expect(expand("CREATE TRIGGER t_x AFTER TRUNCATE ON t FOR EACH STATEMENT EXECUTE FUNCTION f();")).toEqual([]);
    expect(
      expand("CREATE OR REPLACE TRIGGER t_x\n  BEFORE DELETE\n  OR TRUNCATE\n  ON t\n  EXECUTE FUNCTION f();"),
    ).toEqual([]);
  });

  test("truncate_statement_still_refused", () => {
    const refused = { rule: "truncate" };
    expect(expand("TRUNCATE t;")).toEqual([{ line: 2, ...refused }]);
    expect(expand("SELECT 1;\nTRUNCATE TABLE ONLY t;")).toEqual([{ line: 3, ...refused }]);
    expect(expand("CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$\n  TRUNCATE t;\n$$;")).toEqual([
      { line: 3, ...refused },
    ]);
    expect(expand("DO $$ BEGIN EXECUTE 'TRUNCATE t'; END $$;")).toEqual([{ line: 2, ...refused }]);
    expect(expand("SELECT 'a OR TRUNCATE b';")).toEqual([{ line: 2, ...refused }]);
    expect(expand("-- do this BEFORE\nTRUNCATE t;")).toEqual([{ line: 3, ...refused }]);
    expect(expand("CREATE TRIGGER x BEFORE UPDATE OF c OR TRUNCATE ON t EXECUTE FUNCTION f();")).toEqual([
      { line: 2, ...refused },
    ]);
    expect(expand("CREATE TRIGGER x AFTER INSERT ON t EXECUTE FUNCTION f('TRUNCATE');")).toEqual([
      { line: 2, ...refused },
    ]);
  });

  test("contract_may_remove", () => {
    expect(contract("ALTER TABLE x DROP COLUMN y;\nDROP TABLE z;\nALTER TABLE x RENAME TO w;")).toEqual([]);
  });
});

describe("index comment rule", () => {
  test("index_needs_query_comment", () => {
    expect(contract("CREATE INDEX x_idx ON x (y);")).toEqual([{ line: 2, rule: "index_comment" }]);
    expect(contract("-- query: domains/x/repo.ts\nCREATE INDEX x_idx ON x (y);")).toEqual([
      { line: 3, rule: "index_comment" },
    ]);
    expect(contract("-- why: speed\n-- query: domains/x/repo.ts\nCREATE INDEX x_idx ON x (y);")).toEqual([
      { line: 4, rule: "index_comment" },
    ]);
    expect(contract("-- query: domains/x/repo.ts:findById\n-- why: unique\nCREATE UNIQUE INDEX x ON x (y);")).toEqual(
      [],
    );
    expect(expand("-- query: domains/x/repo.ts\n-- why: foreign-key\nCREATE INDEX x_idx ON x (y);")).toEqual([]);
  });

  test("index_query_names_a_file_in_the_repository", () => {
    const index = (query: string) => contract(`-- query: ${query}\n-- why: speed\nCREATE INDEX x_idx ON x (y);`);
    expect(index("domains/x/missing.ts")).toEqual([{ line: 4, rule: "index_query_file" }]);
    expect(index("../outside.ts")).toEqual([{ line: 4, rule: "index_query_file" }]);
    expect(index("/etc/passwd")).toEqual([{ line: 4, rule: "index_query_file" }]);
  });
});
