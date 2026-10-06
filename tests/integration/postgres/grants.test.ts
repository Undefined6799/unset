// P1.12 (infrastructure/postgres/migrations/0003_roles_and_grants.sql, roles.json, grant-matrix.json): the grant-matrix
// test (plan §5.2). It reads every role, grant, membership and default privilege from the catalog of a database migrated
// from scratch and diffs them with the checked-in files, so any drift fails the build with a readable line
// (`+ api SELECT app.drafts`). Per-class rules that hold whatever the matrix says are checked beside it.
//
// It runs on its own container through tests/support/postgres.ts, not the shared integration cluster: roles and their
// memberships are cluster-global, and its temporary migrations (GRANT pg_read_all_data TO backup, a legal_hold_reader
// member) must never leak into another test file (architecture ruling 2026-10-06, P1.12 point 4).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPool, migrate, type Pool, withClient } from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";
import {
  classViolations,
  defaultTableViolations,
  diff,
  type Matrix,
  matrixShapeViolations,
  pluginViolations,
  type RosterRole,
  readState,
} from "./grant-matrix.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const POSTGRES = join(REPOSITORY, "infrastructure", "postgres");
const MIGRATIONS = join(POSTGRES, "migrations");

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const roster = readJson<RosterRole[]>(join(POSTGRES, "roles.json"));
const matrix = readJson<Matrix>(join(POSTGRES, "grant-matrix.json"));
const REGISTRY = join(POSTGRES, "erasure-registry.json");
const registry = existsSync(REGISTRY) ? readJson<Record<string, unknown>>(REGISTRY) : {};
const SERVICE_OR_JOB = roster.filter((r) => r.class === "service" || r.class === "job").map((r) => r.name);

let postgres: PostgresContainer;
const migratorPassword = randomPassword();
const pools: Pool[] = [];

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrated("unset");
}, 120_000);
afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.close()));
  stopAllPostgres();
});

/** A pool on `database` as `user`; migrator unless named. */
function poolFor(database: string, user = "migrator", password = migratorPassword): Pool {
  const pool = createPool({
    connection: { host: "127.0.0.1", port: postgres.port, database, user, password, ssl: false },
    service: "grants-test",
    max: 1,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 10_000,
    idleInTransactionTimeoutMs: 10_000,
  });
  pools.push(pool);
  return pool;
}

/** Runs `dir` (the real migrations unless given) into `database` as migrator; returns a migrator pool on it. */
async function migrated(database: string, dir = MIGRATIONS): Promise<Pool> {
  const result = await migrate({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      database,
      user: "migrator",
      password: migratorPassword,
      ssl: false,
    },
    dir,
    root: REPOSITORY,
    log: createLogger({ service: "migrate", commit: "0".repeat(40), env: "test", write: () => undefined }),
    retryDelaysMs: [],
  });
  if (!result.ok) throw new Error(`migration failed: ${result.reason}`);
  return poolFor(database);
}

/** A new database migrated from scratch, as production's `unset` is: created by the superuser, owned by migrator, with
 * the bootstrap's revokes, so it differs from a fresh `unset` only in name. */
async function freshDatabase(): Promise<{ name: string; pool: Pool }> {
  const name = `g_${randomBytes(6).toString("hex")}`;
  postgres.sql("postgres", `CREATE DATABASE ${name} OWNER migrator`);
  postgres.sql(name, `REVOKE ALL ON DATABASE ${name} FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC`);
  return { name, pool: await migrated(name) };
}

const run = (pool: Pool, sql: string) => withClient(pool, null, (client) => client.query(sql));

// ---- The tests ----

describe("grants", () => {
  test("matrix_matches", async () => {
    const state = await readState(poolFor("unset"));
    expect(diff(matrix, state)).toEqual([]);
    expect(matrixShapeViolations(matrix, state, registry)).toEqual([]);
    expect(defaultTableViolations(state)).toEqual([]);
    expect(classViolations(state, matrix, roster)).toEqual([]);
    expect(pluginViolations(state, matrix, roster)).toEqual([]);
  });

  test("matrix_detects_extra_grant", async () => {
    const { pool } = await freshDatabase();
    await run(pool, "CREATE TABLE app.drafts (id int); GRANT SELECT ON app.drafts TO api");
    const state = await readState(pool);
    expect(diff(matrix, state)).toEqual(["+ api SELECT app.drafts"]);
    expect(classViolations(state, matrix, roster)).toContain("api holds SELECT on app.drafts");
  });

  test("personal_data_by_column_list", async () => {
    const { pool } = await freshDatabase();
    const rows = { "app.t.did": { erase: "delete" } };
    await run(pool, "CREATE TABLE app.t (did text, x int); GRANT SELECT ON app.t TO web");
    let state = await readState(pool);
    const tableLevel = {
      ...matrix,
      tables: { "app.t": { web: { privileges: ["SELECT"], wholeTable: true as const } } },
    };
    expect(diff(tableLevel, state)).toEqual([]);
    expect(matrixShapeViolations(tableLevel, state, rows)).toEqual([
      "app.t web: personal data is granted by column list",
      "app.t web: table-level SELECT on personal data",
    ]);

    await run(
      pool,
      "REVOKE SELECT ON app.t FROM web; GRANT SELECT (did, x) ON app.t TO web; GRANT DELETE ON app.t TO web",
    );
    state = await readState(pool);
    const byColumn = {
      ...matrix,
      tables: { "app.t": { web: { columns: { did: ["SELECT"], x: ["SELECT"] }, rowPrivileges: ["DELETE"] } } },
    };
    expect(diff(byColumn, state)).toEqual([]);
    expect(matrixShapeViolations(byColumn, state, rows)).toEqual([]);
  });

  test("no_default_privilege_reaches_personal_data", async () => {
    expect(defaultTableViolations(await readState(poolFor("unset")))).toEqual([]);
    const { pool } = await freshDatabase();
    await run(pool, "ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA app GRANT SELECT ON TABLES TO web");
    expect(defaultTableViolations(await readState(pool))).toEqual(["default SELECT on tables in app for web"]);
  });

  test("table_grant_needs_whole_table_flag", async () => {
    const { pool } = await freshDatabase();
    await run(pool, "CREATE TABLE app.plain (id int); GRANT SELECT ON app.plain TO admin");
    let state = await readState(pool);
    const unflagged = { ...matrix, tables: { "app.plain": { admin: ["SELECT"] } } };
    expect(diff(unflagged, state)).toEqual([]);
    expect(matrixShapeViolations(unflagged, state, {})).toEqual([
      "app.plain admin: a table-level entry needs wholeTable: true",
    ]);
    const flagged = {
      ...matrix,
      tables: { "app.plain": { admin: { privileges: ["SELECT"], wholeTable: true as const } } },
    };
    expect(matrixShapeViolations(flagged, state, {})).toEqual([]);

    // A column added later inherits the table-level grant, which the flag says is intended: no matrix change.
    await run(pool, "ALTER TABLE app.plain ADD COLUMN later int");
    state = await readState(pool);
    expect(diff(flagged, state)).toEqual([]);

    await run(
      pool,
      "CREATE TABLE app.t (did text, created_at timestamptz); GRANT SELECT (did, created_at) ON app.t TO admin",
    );
    state = await readState(pool);
    const columns = {
      ...flagged,
      tables: { ...flagged.tables, "app.t": { admin: { columns: { did: ["SELECT"], created_at: ["SELECT"] } } } },
    };
    expect(diff(columns, state)).toEqual([]);
    expect(matrixShapeViolations(columns, state, {})).toEqual([]);
  });

  test("roster_complete", async () => {
    const state = await readState(poolFor("unset"));
    for (const role of roster) {
      const found = state.roles.find((r) => r.name === role.name);
      expect(found, role.name).toMatchObject({
        login: role.login,
        limit: role.connectionLimit ?? -1,
        superuser: false,
        createdb: false,
        createrole: false,
        replication: false,
        bypassrls: false,
      });
      const settings = Object.entries(role.settings).map(([key, value]) => `${key}=${value}`);
      expect([...(found?.settings ?? [])].sort(), role.name).toEqual(settings.sort());
    }
    const known = new Set([...roster.map((r) => r.name), "migrator", "tap", "postgres"]);
    expect(state.roles.filter((r) => r.login && !known.has(r.name)).map((r) => r.name)).toEqual([]);
    expect(Object.keys(matrix.roles).sort()).toEqual(roster.map((r) => r.name).sort());

    // A login role whose entry names no password file has none (presence only; a verifier is never read out).
    const withPassword = postgres
      .sql("unset", "SELECT rolname FROM pg_authid WHERE rolpassword IS NOT NULL")
      .split("\n");
    const unset = roster.filter((r) => r.passwordFrom === null).map((r) => r.name);
    expect(unset.filter((name) => withPassword.includes(name))).toEqual([]);
  });

  test("class_assertions", async () => {
    const { name, pool } = await freshDatabase();
    // The audit tables arrive with P1.15; a stand-in shows what the auditor rule refuses.
    postgres.sql(
      name,
      "SET ROLE audit_owner; CREATE TABLE audit.event_body (id int); GRANT SELECT ON audit.event_body TO auditor",
    );
    await run(pool, "CREATE TABLE app.transmission_buffer (id int); GRANT SELECT ON app.transmission_buffer TO backup");
    postgres.sql(
      "postgres",
      "CREATE ROLE t_owner_proxy NOLOGIN; GRANT legal_hold_reader TO t_owner_proxy; " +
        "GRANT t_owner_proxy TO admin; GRANT pg_read_all_data TO backup; GRANT legal_hold_reader TO web",
    );
    try {
      const violations = classViolations(await readState(pool), matrix, roster);
      expect(violations).toEqual(
        expect.arrayContaining([
          "auditor holds SELECT on audit.event_body",
          "backup holds SELECT on app.transmission_buffer",
          "backup reads app.transmission_buffer",
          "backup is a member of pg_read_all_data",
          "web is a member of legal_hold_reader",
          "admin is a member of t_owner_proxy",
          "admin is a member of legal_hold_reader",
        ]),
      );
    } finally {
      postgres.sql(
        "postgres",
        "REVOKE pg_read_all_data FROM backup; REVOKE legal_hold_reader FROM web; " +
          "REVOKE t_owner_proxy FROM admin; DROP ROLE t_owner_proxy",
      );
    }
  });

  test("audit_owner_membership", async () => {
    // migrator keeps SET on audit_owner for P1.15, never its rights; the schema is audit_owner's with exactly the
    // matrix's USAGE grants.
    const rows = postgres.sql(
      "unset",
      "SELECT g.rolname, m.admin_option, m.set_option, m.inherit_option FROM pg_auth_members m " +
        "JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles g ON g.oid = m.grantor " +
        "WHERE r.rolname = 'audit_owner' AND m.member = 'migrator'::regrole ORDER BY 1",
    );
    // The CREATEROLE grant PostgreSQL adds when migrator creates a role (ADMIN only), then the migration's SET grant.
    expect(rows.split("\n")).toEqual(["migrator|f|t|f", "postgres|t|f|f"]);
    const audit = postgres.sql("unset", "SELECT nspowner::regrole, nspacl FROM pg_namespace WHERE nspname = 'audit'");
    expect(audit).toBe(
      "audit_owner|{audit_owner=UC/audit_owner,web=U/audit_owner,indexer=U/audit_owner,admin=U/audit_owner," +
        "retention=U/audit_owner,auditor=U/audit_owner}",
    );
  });

  // Architecture ruling 2026-10-06 (P1.13): the gate on the types domains is USAGE on the schema, and every domain keeps
  // PostgreSQL's default ACL (PUBLIC USAGE, docs 18 ddl-priv Table 5.2). A later explicit grant or revoke on either
  // shows up here as a deliberate change.
  test.each([
    ["types", "admin,api,indexer,web"],
    // P1.16g: retention reaches app for the single-use sweep (P1.16); its table grants come with each table.
    ["app", "admin,retention,web"],
  ])("%s_schema_usage_exact", (schema, roles) => {
    const usage =
      "SELECT string_agg(g, ',' ORDER BY g) FROM (SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' " +
      "ELSE a.grantee::regrole::text END AS g FROM pg_namespace n, aclexplode(n.nspacl) a " +
      `WHERE n.nspname = '${schema}' AND a.privilege_type = 'USAGE' AND a.grantee <> n.nspowner) s`;
    expect(postgres.sql("unset", usage)).toBe(roles);
  });

  test("types_domains_typacl_null", async () => {
    const domains = "SELECT t.typname FROM pg_type t WHERE t.typnamespace = 'types'::regnamespace AND t.typtype = 'd'";
    const explicit = `${domains} AND t.typacl IS NOT NULL ORDER BY 1`;
    expect(postgres.sql("unset", `${domains} ORDER BY 1`).split("\n")).toEqual(["at_uri", "did"]);
    expect(postgres.sql("unset", explicit)).toBe("");
    const { name, pool } = await freshDatabase();
    await run(pool, "REVOKE USAGE ON DOMAIN types.did FROM PUBLIC");
    expect(postgres.sql(name, explicit)).toBe("did");
  });

  test("no_public_execute_on_routines", async () => {
    // Whoever created it (architecture ruling 2026-10-06, point 3): no routine outside the catalogs and extensions may
    // be executed by PUBLIC. migrator's routines get the global default; audit_owner has no default until the step that
    // first creates routines as it (P1.15) adds one, so a stand-in routine shows the check catches it.
    const query =
      "SELECT n.nspname || '.' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, " +
      "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 " +
      "AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND NOT EXISTS (SELECT 1 FROM pg_depend d " +
      "WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')";
    expect(postgres.sql("unset", query)).toBe("");
    const { name, pool } = await freshDatabase();
    await run(pool, "CREATE FUNCTION app.f() RETURNS int LANGUAGE sql AS 'SELECT 1'");
    postgres.sql(name, "SET ROLE audit_owner; CREATE FUNCTION audit.g() RETURNS int LANGUAGE sql AS 'SELECT 1'");
    expect(postgres.sql(name, query)).toBe("audit.g");
  });

  test("api_cannot_read_app", async () => {
    const { name, pool } = await freshDatabase();
    await run(pool, "CREATE TABLE app.probe (id int)");
    const password = await withPassword("api");
    const api = poolFor(name, "api", password);
    await expect(run(api, "SELECT 1 FROM app.probe")).rejects.toMatchObject({ code: "42501" });
  });

  test("no_ddl_for_services", { timeout: 60_000 }, () => {
    for (const role of SERVICE_OR_JOB)
      for (const schema of ["app", "idx", "audit", "types", "public"])
        expect(
          () => postgres.sql("unset", `SET ROLE ${role}; CREATE TABLE ${schema}.ddl_probe (id int)`),
          `${role} ${schema}`,
        ).toThrow(/permission denied for schema/);
  });

  test("role_settings", async () => {
    // Through psql, which sends no settings of its own: a pool sends statement_timeout at startup (P1.11p).
    const password = await withPassword("web");
    const shown = postgres.login(
      "web",
      "unset",
      password,
      "SHOW statement_timeout; SHOW search_path; SELECT current_user",
    );
    expect(shown.split("\n")).toEqual(["2s", '""', "web"]);
    await expect(run(poolFor("unset", "web", password), "CREATE TABLE app.x ()")).rejects.toMatchObject({
      code: "42501",
    });
  });

  test("no_password_no_login", async () => {
    // From the host, so the connection meets the image's password rule; inside the container 127.0.0.1 is trusted.
    await expect(run(poolFor("unset", "review", randomPassword()), "SELECT 1")).rejects.toMatchObject({
      cause: { code: "28P01" },
    });
  });

  test("rerun_in_second_database", async () => {
    // freshDatabase runs every migration, 0003 included, into a new database of a cluster whose roles exist.
    const second = await freshDatabase();
    expect(diff(matrix, await readState(second.pool))).toEqual([]);
  });

  test("plugin_schema_rule", async () => {
    const { pool } = await freshDatabase();
    postgres.sql("postgres", "CREATE ROLE plugin_x LOGIN; ALTER ROLE plugin_x SET search_path = public");
    try {
      await run(
        pool,
        "CREATE SCHEMA plugin_x; GRANT USAGE ON SCHEMA plugin_x TO plugin_x; GRANT USAGE ON SCHEMA app TO plugin_x; GRANT USAGE ON SCHEMA plugin_x TO web",
      );
      expect(pluginViolations(await readState(pool), matrix, roster)).toEqual([
        "plugin_x role's search_path is not its schema",
        "plugin_x holds USAGE on schema app",
        "web holds a privilege on plugin_x",
      ]);
      postgres.sql("postgres", "ALTER ROLE plugin_x SET search_path = plugin_x");
      await run(pool, "REVOKE USAGE ON SCHEMA app FROM plugin_x; REVOKE USAGE ON SCHEMA plugin_x FROM web");
      expect(pluginViolations(await readState(pool), matrix, roster)).toEqual([]);
    } finally {
      await run(pool, "DROP SCHEMA IF EXISTS plugin_x; REVOKE ALL ON SCHEMA app FROM plugin_x");
      postgres.sql("postgres", "DROP ROLE IF EXISTS plugin_x");
    }
  });
});

/** Gives `role` a random password in this test's cluster, as migrator (P1.12p does it from secret files). */
async function withPassword(role: string): Promise<string> {
  const password = randomPassword();
  await run(poolFor("unset"), `ALTER ROLE ${role} PASSWORD '${password}'`);
  return password;
}
