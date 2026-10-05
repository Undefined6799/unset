// P0.09e: classifyGrantChanges (rule SE-6). Only the findings are asserted here; whether the PR as a whole passes
// (and `outside`) is P0.09c's isolation check.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type ChangedPath, classifyGrantChanges, type GrantFinding, type GrantSide } from "./grant-parse.ts";

const MIG = "infrastructure/postgres/migrations";
const BASE_SQL = `${MIG}/0001_base.sql`;
const NEW_SQL = `${MIG}/0042_x.sql`;
const MATRIX = "infrastructure/postgres/grant-matrix.json";
const REGISTRY = "infrastructure/postgres/erasure-registry.json";
const FEATURE = "domains/content/x.ts";
const TRUSTED_FUNCTIONS = [
  "core.erase_*",
  "core.is_erased",
  "core.allow_retrack",
  "core.is_held",
  "mod.erase_foreign_did",
];

const BASE = `
CREATE TABLE app.account (id bigint PRIMARY KEY, did text NOT NULL, c text);
CREATE FUNCTION core.f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
CREATE FUNCTION app.g() RETURNS int LANGUAGE sql SECURITY INVOKER AS $$ SELECT 1 $$;
CREATE VIEW app.v AS SELECT id FROM app.account;
`;

type Scenario = {
  sql?: string;
  file?: string;
  baseSql?: string;
  baseMatrix?: unknown;
  headMatrix?: unknown;
  baseRegistry?: unknown;
  headRegistry?: unknown;
  changed?: ChangedPath[];
};

const json = (value: unknown): string | null =>
  value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** One PR: the base migrations, plus (when `sql` is set) one added migration `file`, beside a feature file. */
function classify(s: Scenario): GrantFinding[] {
  const baseMigrations = [{ path: BASE_SQL, sql: s.baseSql ?? BASE }];
  const file = s.file ?? NEW_SQL;
  const headMigrations = s.sql === undefined ? baseMigrations : [...baseMigrations, { path: file, sql: s.sql }];
  const base: GrantSide = {
    migrations: baseMigrations,
    grantMatrix: json(s.baseMatrix),
    erasureRegistry: json(s.baseRegistry),
  };
  const head: GrantSide = {
    migrations: headMigrations,
    grantMatrix: json(s.headMatrix ?? s.baseMatrix),
    erasureRegistry: json(s.headRegistry ?? s.baseRegistry),
  };
  const changed: ChangedPath[] = s.changed ?? [
    ...(s.sql === undefined ? [] : [{ path: file, status: "A" as const }]),
    ...(s.headMatrix === undefined ? [] : [{ path: MATRIX, status: "M" as const }]),
    ...(s.headRegistry === undefined ? [] : [{ path: REGISTRY, status: "M" as const }]),
    { path: FEATURE, status: "A" },
  ];
  return classifyGrantChanges({ base, head, changed, trustedFunctions: TRUSTED_FUNCTIONS });
}

const trusted = (findings: GrantFinding[]) => findings.filter((f) => f.kind === "trusted");
/** The single finding for a one-statement migration. */
function only(s: Scenario): GrantFinding {
  const findings = classify(s);
  expect(findings, JSON.stringify(findings)).toHaveLength(1);
  return findings[0] as GrantFinding;
}
const kindOf = (s: Scenario) => only(s).kind;

const NEW_X = `
CREATE TABLE app.x (id bigint GENERATED ALWAYS AS IDENTITY, did text NOT NULL);
GRANT SELECT, INSERT ON app.x TO web;
CREATE FUNCTION app.f() RETURNS void LANGUAGE sql SECURITY INVOKER AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION app.f() TO web;
ALTER TABLE app.x ENABLE ROW LEVEL SECURITY;
CREATE VIEW app.v2 AS SELECT id FROM app.x;
GRANT SELECT ON app.v2 TO api;
CREATE SEQUENCE app.s;
GRANT USAGE ON SEQUENCE app.s, app.x_id_seq TO web;
`;
const MATRIX_BASE = { tables: { "app.account": [{ role: "web", privileges: ["SELECT"], columns: ["id", "did"] }] } };

describe("classifyGrantChanges", () => {
  test("grant_parse_feature_create_and_grant_passes", () => {
    const findings = classify({
      sql: NEW_X,
      baseMatrix: MATRIX_BASE,
      headMatrix: {
        tables: {
          ...MATRIX_BASE.tables,
          "app.x": [{ role: "web", privileges: ["SELECT", "INSERT"], wholeTable: true }],
        },
      },
      baseRegistry: {},
      headRegistry: { "app.x.did": { strategy: "delete-row" } },
    });
    expect(trusted(findings)).toEqual([]);
    const byStatement = (start: string) => findings.find((f) => f.statement.startsWith(start))?.kind;
    expect(byStatement("GRANT SELECT, INSERT ON app.x")).toBe("feature");
    expect(byStatement("GRANT EXECUTE ON FUNCTION app.f()")).toBe("feature");
    expect(byStatement("ALTER TABLE app.x ENABLE")).toBe("feature");
    expect(byStatement("GRANT SELECT ON app.v2")).toBe("feature");
    expect(byStatement("GRANT USAGE ON SEQUENCE")).toBe("feature");
    expect(byStatement("CREATE TABLE app.x")).toBe("neutral");
    expect(findings.filter((f) => f.path === MATRIX).map((f) => f.kind)).toEqual(["feature"]);
    expect(findings.filter((f) => f.path === REGISTRY).map((f) => f.kind)).toEqual(["feature"]);
    expect(findings.every((f) => f.path !== FEATURE)).toBe(true);
  });

  test("grant_parse_widen_existing_fails", () => {
    const grant = "GRANT SELECT ON app.account TO api";
    const alone = trusted(classify({ sql: `${grant};\n` }));
    expect(alone).toEqual([
      { path: NEW_SQL, line: 1, kind: "trusted", reason: "existing_object_grant", statement: grant },
    ]);
    const withRow = classify({
      sql: `${grant};`,
      baseMatrix: MATRIX_BASE,
      headMatrix: {
        tables: {
          "app.account": [
            ...MATRIX_BASE.tables["app.account"],
            { role: "api", privileges: ["SELECT"], wholeTable: true },
          ],
        },
      },
    });
    expect(withRow.map((f) => [f.path, f.kind])).toEqual([
      [NEW_SQL, "trusted"],
      [MATRIX, "trusted"],
    ]);
    const mixed = classify({ sql: `CREATE TABLE app.y (id bigint);\n${grant};` });
    expect(mixed.map((f) => [f.line, f.kind])).toEqual([
      [1, "neutral"],
      [2, "trusted"],
    ]);
  });

  test("grant_parse_unparseable_fails", () => {
    const cases: Scenario[] = [
      { sql: "DO $$ BEGIN EXECUTE 'GR' || 'ANT SELECT ON app.account TO api'; END $$;" },
      { sql: "CREATE FUNCTION app.h() RETURNS int AS $body$ SELECT 1;" },
      { sql: "SECURITY LABEL FOR selinux ON TABLE app.account IS 'x';" },
      { baseRegistry: {}, headRegistry: "{ not json" },
      { baseMatrix: MATRIX_BASE, headMatrix: { ...MATRIX_BASE, extra: {} } },
      { sql: "SELECT 'unterminated;" },
      { sql: 'GRANT SELECT ON "app.account TO api;' },
      { sql: "/* unterminated GRANT;" },
    ];
    for (const s of cases)
      expect(
        trusted(classify(s)).map((f) => f.reason),
        JSON.stringify(s),
      ).toEqual(["unclassified"]);
  });

  test("grant_parse_replace_definer_fails", () => {
    const sql = "CREATE OR REPLACE FUNCTION core.f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 2 $$;";
    expect(only({ sql })).toMatchObject({ kind: "trusted", reason: "existing_function_or_view_changed", line: 1 });
  });

  test("grant_parse_existing_function_or_view_changed", () => {
    const five = [
      "CREATE OR REPLACE FUNCTION app.g() RETURNS int LANGUAGE sql SECURITY INVOKER AS $$ SELECT 2 $$",
      "CREATE OR REPLACE VIEW app.v AS SELECT id, did FROM app.account",
      "ALTER FUNCTION app.g() SET search_path = pg_catalog, app",
      "ALTER FUNCTION app.g() SECURITY DEFINER",
      "ALTER VIEW app.v OWNER TO web",
    ];
    for (const sql of five) {
      expect(only({ sql: `${sql};` }), sql).toMatchObject({
        kind: "trusted",
        reason: "existing_function_or_view_changed",
      });
    }
    const baseSql = "CREATE TABLE app.account (id bigint, did text);";
    const created =
      "CREATE FUNCTION app.g() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\nCREATE VIEW app.v AS SELECT 1;\n";
    // On objects the PR creates (ruling 2026-10-05): a new body or search_path rides; a view over an existing table
    // without security_invoker, a switch to SECURITY DEFINER and a new owner do not.
    const onCreated = [
      "neutral",
      "definer_view_over_existing",
      "neutral",
      "owner_or_security_changed",
      "owner_or_security_changed",
    ];
    for (const [i, sql] of five.entries()) {
      const findings = classify({ baseSql, sql: `${created}${sql};` });
      expect(findings.at(-1)?.reason === "neutral" ? "neutral" : findings.at(-1)?.reason, sql).toBe(onCreated[i]);
      expect(findings.slice(0, 2).map((f) => f.kind)).toEqual(["neutral", "neutral"]);
    }
  });

  test("grant_parse_add_column", () => {
    const sql = "ALTER TABLE app.account ADD COLUMN bio text;";
    const tableLevel = (flag: boolean) => ({
      tables: { "app.account": [{ role: "web", privileges: ["SELECT"], ...(flag ? { wholeTable: true } : {}) }] },
    });
    expect(kindOf({ sql, baseMatrix: tableLevel(true) })).toBe("neutral");
    expect(only({ sql, baseMatrix: tableLevel(false) })).toMatchObject({
      kind: "trusted",
      reason: "existing_table_add_column",
    });
    expect(kindOf({ sql, baseMatrix: MATRIX_BASE })).toBe("neutral");
    expect(kindOf({ sql, baseMatrix: { tables: {} } })).toBe("trusted");
    expect(kindOf({ sql })).toBe("trusted");
    expect(kindOf({ sql, baseMatrix: "{ broken" })).toBe("trusted");
    const flagSet = classify({ baseMatrix: tableLevel(false), headMatrix: tableLevel(true) });
    expect(flagSet).toMatchObject([{ path: MATRIX, kind: "trusted", reason: "matrix_existing_object" }]);
  });

  test("grant_parse_cases", () => {
    const addC2 = "ALTER TABLE app.account ADD COLUMN c2 text;\n";
    const wide = {
      baseMatrix: { tables: { "app.account": [{ role: "web", privileges: ["SELECT"], wholeTable: true }] } },
    };
    const rows: [string, Scenario, GrantFinding["kind"], string?][] = [
      [
        "default privileges",
        { sql: "ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO web;" },
        "trusted",
      ],
      ["create role", { sql: "CREATE ROLE x;" }, "trusted", "role"],
      ["membership", { sql: "GRANT audit_owner TO migrator;" }, "trusted", "role"],
      ["schema grant", { sql: "GRANT USAGE ON SCHEMA mod TO admin;" }, "trusted", "schema_grant"],
      ["policy new", { sql: "CREATE TABLE app.x (id int);\nCREATE POLICY p ON app.x USING (true);" }, "feature"],
      ["policy existing", { sql: "CREATE POLICY p ON app.account USING (true);" }, "trusted"],
      ["column grant new", { ...wide, sql: `${addC2}GRANT SELECT (c2) ON app.account TO admin;` }, "feature"],
      ["column grant existing", { sql: "GRANT SELECT (c) ON app.account TO admin;" }, "trusted"],
      ["column grant mixed", { ...wide, sql: `${addC2}GRANT SELECT (c, c2) ON app.account TO admin;` }, "trusted"],
      ["table grant after add", { ...wide, sql: `${addC2}GRANT SELECT ON app.account TO admin;` }, "trusted"],
      ["alter role", { sql: "ALTER ROLE web PASSWORD 'secret';" }, "trusted", "role"],
      [
        "revoke all in schema",
        { sql: "REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;" },
        "trusted",
        "schema_grant",
      ],
      ["replace base fn", { sql: "CREATE OR REPLACE FUNCTION app.g() RETURNS int AS $$ SELECT 3 $$;" }, "trusted"],
      ["trusted fn", { sql: "CREATE FUNCTION core.erase_x() RETURNS void AS $$ $$;" }, "trusted", "trusted_function"],
      ["owner to", { sql: "CREATE TABLE app.x (id int);\nALTER TABLE app.x OWNER TO web;" }, "trusted", "unclassified"],
      ["set role", { sql: "SET ROLE audit_owner;" }, "neutral"],
      ["drop table", { sql: "DROP TABLE app.account;" }, "trusted", "unclassified"],
      ["string", { sql: "INSERT INTO app.account (c) VALUES ('GRANT SELECT ON app.account TO api; x');" }, "neutral"],
      [
        "comment",
        {
          sql: "-- GRANT SELECT ON app.account TO api;\n/* GRANT /* nested */ ; */ COMMENT ON TABLE app.account IS E'it\\'s; GRANT';",
        },
        "neutral",
      ],
      ["dollar", { sql: "CREATE FUNCTION app.h() RETURNS int AS $f$ GRANT; $$ ; $f$ LANGUAGE sql;" }, "neutral"],
      ["quoted", { sql: 'GRANT SELECT ON "App"."Account" TO api;' }, "trusted", "existing_object_grant"],
    ];
    for (const [name, s, kind, reason] of rows) {
      const findings = classify(s);
      const last = findings.filter((f) => f.path === NEW_SQL).at(-1);
      expect(last?.kind, name).toBe(kind);
      if (reason !== undefined) expect(last?.reason, name).toBe(reason);
    }
    // "App"."Account" is a different relation from app.account (quoted names keep case); it is still not new.
    expect(only({ sql: "GRANT SELECT ON APP.ACCOUNT TO api;" }).statement).toBe("GRANT SELECT ON APP.ACCOUNT TO api");
  });

  test("grant_parse_cases: merged migrations and JSON rows", () => {
    const modified = classify({ changed: [{ path: BASE_SQL, status: "M" }] });
    expect(modified).toMatchObject([{ path: BASE_SQL, kind: "trusted", reason: "unclassified" }]);
    for (const status of ["D", "R"] as const) {
      expect(trusted(classify({ changed: [{ path: BASE_SQL, status }] }))).toHaveLength(1);
    }
    const row = [{ role: "api", privileges: ["SELECT"], columns: ["id"] }];
    expect(classify({ baseMatrix: { tables: {} }, headMatrix: { tables: { "app.account": row } } })).toMatchObject([
      { path: MATRIX, kind: "trusted", reason: "matrix_existing_object" },
    ]);
    const created = classify({
      sql: "CREATE TABLE app.n (id int);",
      baseMatrix: { tables: {} },
      headMatrix: { tables: { "app.n": row } },
    });
    expect(created.map((f) => f.kind)).toEqual(["neutral", "feature"]);
    expect(classify({ baseMatrix: {}, headMatrix: { schemas: { app: ["web"] } } })).toMatchObject([
      { kind: "trusted", reason: "matrix_schemas" },
    ]);
    const reg = (registry: unknown, sql?: string) =>
      classify({
        baseRegistry: { "app.account.did": { strategy: "delete-row" } },
        headRegistry: registry,
        ...(sql ? { sql } : {}),
      })
        .filter((f) => f.path === REGISTRY)
        .map((f) => [f.kind, f.reason]);
    const kept = { "app.account.did": { strategy: "delete-row" } };
    expect(
      reg({ ...kept, "app.account.bio": { strategy: "null" } }, "ALTER TABLE app.account ADD COLUMN bio text;"),
    ).toEqual([["feature", "registry_row_created_column"]]);
    expect(reg({ "app.account.did": { strategy: "null" } })).toEqual([["trusted", "registry_row_changed"]]);
    expect(reg({})).toEqual([["trusted", "registry_row_changed"]]);
    expect(reg({ ...kept, "app.account.c": { strategy: "null" } })).toEqual([["trusted", "unclassified"]]);
    expect(classify({ changed: [{ path: "infrastructure/postgres/roles.json", status: "M" }] })).toEqual([]);
  });

  test("grant_parse_trusted_families", () => {
    const fn = (name: string, security = "SECURITY DEFINER", body = "SELECT 1") =>
      `CREATE FUNCTION ${name}() RETURNS int LANGUAGE sql ${security} AS $$ ${body} $$;`;
    expect(only({ sql: fn("audit.append", "") })).toMatchObject({ kind: "trusted", reason: "trusted_family_unnamed" });
    expect(only({ sql: fn("app.hold"), file: `${MIG}/0050_legal-hold.sql` }).reason).toBe("trusted_family_unnamed");
    expect(only({ sql: fn("app.hold"), file: `${MIG}/0050_legal_hold.sql` }).reason).toBe("trusted_family_unnamed");
    expect(only({ sql: fn("app.hold", undefined, "SELECT 1 FROM mod.legal_hold") }).reason).toBe(
      "trusted_family_unnamed",
    );
    expect(kindOf({ sql: fn("app.hold", "SECURITY INVOKER"), file: `${MIG}/0050_legal_hold.sql` })).toBe("neutral");
    // Any new SECURITY DEFINER function is trusted base (ruling 2026-10-05); the invoker default rides.
    expect(only({ sql: fn("app.hold") }).reason).toBe("security_definer");
    expect(kindOf({ sql: fn("app.hold", "") })).toBe("neutral");
    for (const name of ["core.is_erased", "CORE.ERASE_did", "mod.erase_foreign_did"]) {
      expect(only({ sql: fn(name) }).reason, name).toBe("trusted_function");
    }
    expect(kindOf({ sql: fn("core.erased", "") })).toBe("neutral");
    const grantOnTrusted =
      "CREATE FUNCTION core.is_held() RETURNS bool AS $$ $$;\nGRANT EXECUTE ON FUNCTION core.is_held() TO web;";
    expect(trusted(classify({ sql: grantOnTrusted })).map((f) => f.reason)).toEqual([
      "trusted_function",
      "trusted_function",
    ]);
  });
});

describe("SQL this tokenizer must not read differently from Postgres (review, 2026-10-05)", () => {
  const last = (sql: string) => classify({ sql }).at(-1) as GrantFinding;

  test("grant_parse_lexer_disagreements_fail_closed", () => {
    // Postgres ends a -- comment at a lone CR, so the GRANT runs.
    expect(trusted(classify({ sql: "-- note\rGRANT SELECT ON app.account TO api;\n" }))).toHaveLength(1);
    // U+00A0 is whitespace to JavaScript but an identifier byte to Postgres, so no dollar quote opens.
    const nbsp =
      "UPDATE app.t AS\u00a0$z$ SET c = 1; GRANT SELECT ON app.account TO api; UPDATE app.t AS\u00a0$z$ SET c = 1;";
    expect(only({ sql: nbsp })).toMatchObject({ kind: "trusted", reason: "unclassified" });
    // A U& escape spells any name.
    expect(only({ sql: 'GRANT SELECT ON app.U&"\\0061ccount" TO api;' })).toMatchObject({ reason: "unclassified" });
  });

  test("grant_parse_set_local_allowlist", () => {
    expect(last("SET LOCAL SCHEMA 'app';")).toMatchObject({ reason: "unclassified" });
    expect(last("SET LOCAL search_path = app;")).toMatchObject({ reason: "unclassified" });
    expect(last("SET LOCAL standard_conforming_strings = off;")).toMatchObject({ reason: "unclassified" });
    expect(last("SET LOCAL lock_timeout = '5s';")).toMatchObject({ kind: "neutral" });
  });

  test("grant_parse_unqualified_names_fail_closed", () => {
    expect(last("CREATE TABLE x (id int);\nGRANT SELECT ON x TO api;").kind).toBe("trusted");
  });

  test("grant_parse_column_grant_with_table_wide_privilege", () => {
    const add = "ALTER TABLE app.account ADD COLUMN c2 text;\n";
    expect(last(`${add}GRANT SELECT (c2), UPDATE ON app.account TO api;`).kind).toBe("trusted");
    expect(last(`${add}GRANT SELECT (c2), UPDATE (c2) ON app.account TO api;`).kind).toBe("feature");
  });

  test("grant_parse_if_not_exists_never_creates", () => {
    const column =
      "ALTER TABLE app.account ADD COLUMN IF NOT EXISTS email text;\nGRANT SELECT (email) ON app.account TO api;";
    expect(last(column).kind).toBe("trusted");
    expect(last("CREATE TABLE IF NOT EXISTS app.n (id int);\nGRANT SELECT ON app.n TO api;").kind).toBe("trusted");
  });

  test("grant_parse_matrix_findings_name_the_real_file", () => {
    const headMatrix = { tables: { ...MATRIX_BASE.tables, "app.account": [{ role: "api", privileges: ["SELECT"] }] } };
    const findings = classify({
      baseMatrix: MATRIX_BASE,
      headMatrix,
      changed: [
        { path: "apps/web/grant-matrix.json", status: "A" },
        { path: MATRIX, status: "M" },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([MATRIX]);
  });
});

describe("what reads or watches existing data (ruling 2026-10-05)", () => {
  const last = (sql: string) => classify({ sql }).at(-1) as GrantFinding;
  const NEW_T = "CREATE TABLE app.t (id bigint);\n";

  test("grant_parse_watchers_and_copies", () => {
    const trigger = "CREATE TRIGGER tr AFTER INSERT ON app.account FOR EACH ROW EXECUTE FUNCTION app.h();";
    expect(last(trigger)).toMatchObject({ kind: "trusted", reason: "existing_object_trigger_or_rule" });
    expect(last(`${NEW_T}${trigger.replace("app.account", "app.t")}`).kind).toBe("feature");
    expect(last("CREATE RULE r AS ON INSERT TO app.account DO ALSO NOTHING;").kind).toBe("trusted");
    for (const copy of [
      "CREATE TABLE app.c AS SELECT * FROM app.account;",
      "CREATE TABLE app.c PARTITION OF app.account FOR VALUES IN (1);",
      "CREATE TABLE app.c (LIKE app.account);",
      "CREATE TABLE app.c (x int) INHERITS (app.account);",
    ]) {
      expect(last(copy), copy).toMatchObject({ kind: "trusted", reason: "table_from_existing" });
    }
  });

  test("grant_parse_views_and_functions_by_rights", () => {
    const over = "AS SELECT id FROM app.account;";
    expect(last(`CREATE VIEW app.w ${over}`).reason).toBe("definer_view_over_existing");
    expect(last(`CREATE VIEW app.w WITH (security_invoker = true) ${over}`).kind).toBe("neutral");
    expect(last(`CREATE VIEW app.w WITH (security_invoker) ${over}`).kind).toBe("neutral");
    expect(last(`CREATE VIEW app.w WITH (security_invoker = false) ${over}`).kind).toBe("trusted");
    expect(last(`CREATE MATERIALIZED VIEW app.w ${over}`).kind).toBe("trusted");
    expect(last(`${NEW_T}CREATE VIEW app.w AS SELECT id FROM app.t;`).kind).toBe("neutral");
    const fn = (security: string) => `CREATE FUNCTION app.k() RETURNS int LANGUAGE sql ${security} AS $$ SELECT 1 $$;`;
    expect(last(fn("SECURITY DEFINER")).reason).toBe("security_definer");
    expect(last(fn("SECURITY INVOKER")).kind).toBe("neutral");
    expect(last(fn("")).kind).toBe("neutral");
  });
});

describe("callers", () => {
  /** The tracked TypeScript files that import grant-parse.ts for its values. */
  const importers = (): string[] => {
    const root = join(import.meta.dirname, "..", "..");
    const files = execFileSync("git", ["ls-files", "*.ts"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    // A type-only import runs nothing, so it is not a caller.
    const caller = /^import (?!type )[^;]*?from "[^"]*\/grant-parse\.ts"/m;
    return files.filter((file) => caller.test(readFileSync(join(root, file), "utf8")));
  };

  test("no_runtime_caller_yet", () => {
    // P0.09e shipped the classifier with no caller; P0.09c flipped this to its one caller, the pr-shape job.
    const callers = importers().filter((file) => !file.endsWith(".test.ts"));
    expect(callers).toEqual(["scripts/guards/change-shape.ts"]);
    expect(importers()).toContain("scripts/guards/grant-parse.test.ts");
  });
});
