// P0.09c: the grant classifier and the trusted-base isolation check together, on the PRs the book's grant_parse_*
// tests describe. grant-parse.test.ts asserts the findings; this file asserts what the PR as a whole gets.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type ChangedPath, classifyGrantChanges, type GrantSide } from "./grant-parse.ts";
import { checkTrustedBaseIsolation, readTrustedBase } from "./trusted-base.ts";

const read = readTrustedBase(readFileSync(join(import.meta.dirname, "..", "..", ".github/CODEOWNERS"), "utf8"));
if (!read.ok) throw new Error(read.error);
const { patterns, parsedPaths, trustedFunctions } = read.section;

const MIG = "infrastructure/postgres/migrations";
const NEW_SQL = `${MIG}/0042_x.sql`;
const MATRIX = "infrastructure/postgres/grant-matrix.json";
const FEATURE = "domains/content/x.ts";
const GRANTS_TEST = "tests/integration/postgres/grants.test.ts";
const BASE_SQL = `
CREATE TABLE app.account (id bigint PRIMARY KEY, did text NOT NULL);
CREATE FUNCTION core.f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
`;
const tables = (wholeTable: boolean) =>
  JSON.stringify({ tables: { "app.account": [{ role: "web", privileges: ["SELECT"], wholeTable }] } });

type Pr = { sql: string; others: string[]; baseMatrix?: string; headMatrix?: string };

/** The isolation verdict for a PR adding one migration beside `others` (paths the classifier does not read). */
function verdict(pr: Pr) {
  const side = (migrations: GrantSide["migrations"], matrix: string | undefined): GrantSide => ({
    migrations,
    grantMatrix: matrix ?? null,
    erasureRegistry: null,
  });
  const base = [{ path: `${MIG}/0001_base.sql`, sql: BASE_SQL }];
  const changed: ChangedPath[] = [
    { path: NEW_SQL, status: "A" },
    ...pr.others.map((path) => ({ path, status: "A" as const })),
  ];
  const findings = classifyGrantChanges({
    base: side(base, pr.baseMatrix),
    head: side([...base, { path: NEW_SQL, sql: pr.sql }], pr.headMatrix ?? pr.baseMatrix),
    changed,
    trustedFunctions,
  });
  return checkTrustedBaseIsolation(
    changed.map((c) => c.path),
    patterns,
    {
      parsedPaths,
      findings,
      docs: {
        regular: new Set(changed.map((c) => c.path)),
        licenceOnly: new Set(),
        dependencyChanges: new Set(),
        lockfiles: null,
      },
    },
  );
}

describe("a PR's grants decide whether it touches the trusted base (SE-6)", () => {
  test("grant_parse_feature_create_and_grant_passes", () => {
    const sql = `CREATE TABLE app.x (id bigint, did text);
GRANT SELECT, INSERT ON app.x TO web;
CREATE FUNCTION app.f() RETURNS void LANGUAGE sql SECURITY INVOKER AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION app.f() TO web;
ALTER TABLE app.x ENABLE ROW LEVEL SECURITY;`;
    expect(verdict({ sql, others: [FEATURE] })).toEqual({ ok: true, touched: false });
  });

  test("grant_parse_widen_existing_fails", () => {
    const sql = "GRANT SELECT ON app.account TO api;";
    expect(verdict({ sql, others: [FEATURE] })).toEqual({ ok: false, outside: [FEATURE] });
    // With its grant-matrix.json row (an existing table's, so trusted too) and its integration test.
    const headMatrix = JSON.stringify({ tables: { "app.account": [{ role: "api", privileges: ["SELECT"] }] } });
    expect(verdict({ sql, others: [MATRIX, GRANTS_TEST], baseMatrix: tables(false), headMatrix })).toEqual({
      ok: true,
      touched: true,
    });
    expect(verdict({ sql: `CREATE TABLE app.y (id bigint);\n${sql}`, others: [] })).toEqual({
      ok: false,
      outside: [`${NEW_SQL} (mixed_grant_change)`],
    });
  });

  test("create_schema_with_grant_in_same_file_is_mixed", () => {
    // P0.09m: the bare schema is neutral and its USAGE grant trusted, so one migration holding both is mixed.
    expect(verdict({ sql: "CREATE SCHEMA plugin_x;", others: [FEATURE] })).toEqual({ ok: true, touched: false });
    expect(verdict({ sql: "CREATE SCHEMA plugin_x;\nGRANT USAGE ON SCHEMA plugin_x TO web;", others: [] })).toEqual({
      ok: false,
      outside: [`${NEW_SQL} (mixed_grant_change)`],
    });
  });

  test("trusted_file_with_set_role_is_trusted", () => {
    // P1.15q: a trusted migration creates its functions as their owner, so SET ROLE and RESET ROLE may ride with it.
    const sql =
      "SET ROLE audit_owner;\nALTER DEFAULT PRIVILEGES FOR ROLE audit_owner REVOKE EXECUTE ON ROUTINES FROM PUBLIC;\nRESET ROLE;";
    expect(verdict({ sql, others: [GRANTS_TEST] })).toEqual({ ok: true, touched: true });
    expect(verdict({ sql, others: [FEATURE] })).toEqual({ ok: false, outside: [FEATURE] });
  });

  test("set_role_with_feature_statement_still_mixed", () => {
    const sql =
      "SET ROLE audit_owner;\nCREATE TABLE app.y (id bigint);\nGRANT USAGE ON SCHEMA app TO api;\nRESET ROLE;";
    expect(verdict({ sql, others: [] })).toEqual({ ok: false, outside: [`${NEW_SQL} (mixed_grant_change)`] });
  });

  test("set_role_only_file_not_trusted", () => {
    expect(verdict({ sql: "SET ROLE audit_owner;\nRESET ROLE;", others: [FEATURE] })).toEqual({
      ok: true,
      touched: false,
    });
  });

  test("set_role_with_extra_tokens_unclassified", () => {
    // Only the exact two forms are left out; any other spelling still counts against a trusted file.
    const grant = "GRANT USAGE ON SCHEMA app TO api;";
    for (const role of [
      "SET ROLE audit_owner NOWAIT;",
      "SET ROLE audit_owner, web;",
      'SET ROLE "audit_owner";',
      "set role audit_owner;",
      "SET LOCAL ROLE audit_owner;",
    ])
      expect(verdict({ sql: `${role}\n${grant}`, others: [] }), role).toEqual({
        ok: false,
        outside: [`${NEW_SQL} (mixed_grant_change)`],
      });
  });

  test("grant_parse_unparseable_fails", () => {
    const sql = "DO $$ BEGIN EXECUTE 'GR' || 'ANT SELECT ON app.account TO api'; END $$;";
    expect(verdict({ sql, others: [FEATURE] })).toEqual({ ok: false, outside: [FEATURE] });
    expect(verdict({ sql: "CREATE TABLE app.z (body text DEFAULT $q$ never closed", others: [FEATURE] }).ok).toBe(
      false,
    );
  });

  test("grant_parse_replace_definer_fails", () => {
    const sql = "CREATE OR REPLACE FUNCTION core.f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 2 $$;";
    expect(verdict({ sql, others: [FEATURE] })).toEqual({ ok: false, outside: [FEATURE] });
    expect(verdict({ sql, others: [GRANTS_TEST] })).toEqual({ ok: true, touched: true });
  });

  test("grant_parse_add_column", () => {
    const sql = "ALTER TABLE app.account ADD COLUMN bio text;";
    expect(verdict({ sql, others: [FEATURE], baseMatrix: tables(true) })).toEqual({ ok: true, touched: false });
    expect(verdict({ sql, others: [FEATURE], baseMatrix: tables(false) })).toEqual({ ok: false, outside: [FEATURE] });
    expect(verdict({ sql, others: [FEATURE] })).toEqual({ ok: false, outside: [FEATURE] });
  });
});
