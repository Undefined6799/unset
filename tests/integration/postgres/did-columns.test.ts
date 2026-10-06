// P1.13 (infrastructure/postgres/didColumns.ts, migration 0004, erasure-registry.json): every column that can hold a
// DID is found in pg_catalog, and the build fails while one has no erasure row (plan section 2 rule 11). The catalog
// is the list; a hand-kept list drifts (prototype appview erasure fix e9a014f, review 07 section 3).
//
// It runs on its own container through tests/support/postgres.ts, like grants.test.ts: the cases add tables as
// migrator, which owns the schemas, in throwaway databases. The domain checks run as `web`, the role that writes.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPool, didColumns, migrate, type Pool, withClient } from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

type Row = { strategy: string; class?: string; reason?: string };
type Registry = Record<string, Row>;

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const POSTGRES = join(REPOSITORY, "infrastructure", "postgres");
const registry = JSON.parse(readFileSync(join(POSTGRES, "erasure-registry.json"), "utf8")) as Registry;
const STRATEGIES = ["delete_row", "set_null", "retain", "audit_redact", "retain_legal_hold"];
/** Text columns whose names look like a DID but are not one, each with its reason. The only way past step 2. */
const NOT_A_DID: readonly string[] = [];
/** Names a DID column often has; a text column named so must use the domain (step 2). */
const SUSPICIOUS_NAME = `'(^|_)did($|_)|_did$|^did|(^|_)(uri|at_uri)$|^(subject|actor|author|owner|target)$'`;

const migratorPassword = randomPassword();
const webPassword = randomPassword();
const pools: Pool[] = [];
let postgres: PostgresContainer;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateInto("unset");
  postgres.sql("postgres", `ALTER ROLE web PASSWORD '${webPassword}'`);
}, 120_000);
afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.close()));
  stopAllPostgres();
});

function poolFor(database: string, user = "migrator", password = migratorPassword): Pool {
  const pool = createPool({
    connection: { host: "127.0.0.1", port: postgres.port, database, user, password, ssl: false },
    service: "did-columns-test",
    max: 1,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 10_000,
    idleInTransactionTimeoutMs: 10_000,
  });
  pools.push(pool);
  return pool;
}

async function migrateInto(database: string): Promise<void> {
  const result = await migrate({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      database,
      user: "migrator",
      password: migratorPassword,
      ssl: false,
    },
    dir: join(POSTGRES, "migrations"),
    root: REPOSITORY,
    log: createLogger({ service: "migrate", commit: "0".repeat(40), env: "test", write: () => undefined }),
    retryDelaysMs: [],
  });
  if (!result.ok) throw new Error(`migration failed: ${result.reason}`);
}

/** A database migrated from scratch, then `sql` run as migrator: the "temporary migration" of each case. */
async function migratedWith(sql: string): Promise<Pool> {
  const name = `d_${randomBytes(6).toString("hex")}`;
  postgres.sql("postgres", `CREATE DATABASE ${name} OWNER migrator`);
  postgres.sql(name, `REVOKE ALL ON DATABASE ${name} FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC`);
  await migrateInto(name);
  const pool = poolFor(name);
  await withClient(pool, null, (client) => client.query(sql));
  return pool;
}

const rows = <T>(pool: Pool, sql: string): Promise<T[]> =>
  withClient(pool, null, async (client) => (await client.query(sql)).rows as T[]);

/** Step 2: text columns named like a DID that do not use the domain, in every table outside the system schemas. */
async function suspicious(pool: Pool, notADid: readonly string[] = NOT_A_DID): Promise<string[]> {
  const found = await rows<{ key: string }>(
    pool,
    `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS key
       FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
        AND t.typname IN ('text', 'varchar', '_text', '_varchar') AND a.attname ~ ${SUSPICIOUS_NAME}
      ORDER BY 1`,
  );
  return found.map((r) => r.key).filter((key) => !notADid.includes(key));
}

/** Step 4: a row's strategy is known, a retained row says how long and why, and set_null needs a nullable column. */
function rowProblems(key: string, row: Row, notNull: ReadonlySet<string>): string[] {
  if (!STRATEGIES.includes(row.strategy)) return [`${key}: unknown strategy ${row.strategy}`];
  const out: string[] = [];
  if ((row.strategy === "retain" || row.strategy === "audit_redact") && !(row.class && row.reason))
    out.push(`${key}: ${row.strategy} needs a class and a reason`);
  if (row.strategy === "audit_redact" && row.class !== undefined && row.class !== "mod")
    out.push(`${key}: audit_redact keeps mod-lane rows, so its class is mod`);
  if (row.strategy === "set_null" && notNull.has(key)) out.push(`${key}: set_null on a NOT NULL column`);
  return out;
}

/** Steps 1 to 5 on one database; each problem is one readable line. */
async function registryProblems(pool: Pool, rows_: Registry = registry): Promise<string[]> {
  const columns = (await didColumns(pool)).map((c) => `${c.schema}.${c.table}.${c.column}`);
  const notNull = new Set(
    (
      await rows<{ key: string }>(
        pool,
        `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS key
           FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE a.attnotnull AND a.attnum > 0`,
      )
    ).map((r) => r.key),
  );
  const foreign = await rows<{ key: string }>(
    pool,
    `SELECT n.nspname || '.' || c.relname AS key FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'f'`,
  );
  return [
    ...(await suspicious(pool)).map((key) => `${key} looks like a DID but is not types.did or types.at_uri`),
    ...columns.filter((key) => !(key in rows_)).map((key) => `add an erasure row for ${key}`),
    ...Object.keys(rows_)
      .filter((key) => !columns.includes(key))
      .map((key) => `stale registry row ${key}`),
    ...Object.entries(rows_).flatMap(([key, row]) => rowProblems(key, row, notNull)),
    ...foreign.map((r) => `${r.key} is a foreign table`),
  ];
}

/** The SQLSTATE a statement fails with as `web`, or "ok". */
async function asWeb(sql: string): Promise<string> {
  try {
    await withClient(poolFor("unset", "web", webPassword), null, (client) => client.query(sql));
    return "ok";
  } catch (error) {
    return String(
      (error as { code?: unknown; cause?: { code?: unknown } }).cause?.code ?? (error as { code?: unknown }).code,
    );
  }
}

const PLC = "did:plc:abcdefghijklmnopqrstuvwx";

describe("DID columns", () => {
  test("registry_complete", async () => {
    expect(await registryProblems(poolFor("unset"))).toEqual([]);
  });

  test("detects_missing_row", async () => {
    const pool = await migratedWith("CREATE TABLE app.t (owner types.did)");
    expect(await didColumns(pool)).toEqual([{ schema: "app", table: "t", column: "owner", kind: "did" }]);
    expect(await registryProblems(pool)).toEqual(["add an erasure row for app.t.owner"]);
  });

  test("detects_stale_row", async () => {
    const stale = { ...registry, "app.gone.did": { strategy: "delete_row" } };
    expect(await registryProblems(poolFor("unset"), stale)).toEqual(["stale registry row app.gone.did"]);
  });

  test("detects_plain_text_did", async () => {
    const pool = await migratedWith("CREATE TABLE app.u (subject_did text)");
    expect(await registryProblems(pool)).toEqual([
      "app.u.subject_did looks like a DID but is not types.did or types.at_uri",
    ]);
  });

  test("at_uri_column_needs_row", async () => {
    const pool = await migratedWith(
      "CREATE TABLE idx.r (record_uri types.at_uri, uris types.at_uri[], dids types.did[]); CREATE TABLE idx.s (record_uri text)",
    );
    expect((await didColumns(pool)).map((c) => `${c.table}.${c.column} ${c.kind}`)).toEqual([
      "r.dids did[]",
      "r.record_uri at_uri",
      "r.uris at_uri[]",
    ]);
    expect(await registryProblems(pool)).toEqual([
      "idx.s.record_uri looks like a DID but is not types.did or types.at_uri",
      "add an erasure row for idx.r.dids",
      "add an erasure row for idx.r.record_uri",
      "add an erasure row for idx.r.uris",
    ]);
  });

  test("allows_listed_non_did", async () => {
    const pool = await migratedWith("CREATE TABLE app.v (owner text)");
    expect(await suspicious(pool)).toEqual(["app.v.owner"]);
    expect(await suspicious(pool, ["app.v.owner"])).toEqual([]);
  });

  test("retain_needs_reason", async () => {
    const pool = await migratedWith(
      "CREATE TABLE app.w (a types.did NOT NULL, b types.did, c types.did, d types.did, e types.did)",
    );
    const rows_: Registry = {
      "app.w.a": { strategy: "set_null" },
      "app.w.b": { strategy: "retain" },
      "app.w.c": { strategy: "audit_redact", class: "sec", reason: "audit" },
      "app.w.d": { strategy: "retain", class: "billing", reason: "tax law" },
      "app.w.e": { strategy: "forget" },
    };
    expect(await registryProblems(pool, rows_)).toEqual([
      "app.w.a: set_null on a NOT NULL column",
      "app.w.b: retain needs a class and a reason",
      "app.w.c: audit_redact keeps mod-lane rows, so its class is mod",
      "app.w.e: unknown strategy forget",
    ]);
  });

  test("domain_check", async () => {
    expect(await asWeb(`SELECT '${PLC}'::types.did`)).toBe("ok");
    expect(await asWeb("SELECT 'did:web:example.com'::types.did")).toBe("ok");
    expect(await asWeb("SELECT 'did:web:sub.example.co.uk'::types.did")).toBe("ok");
    for (const bad of [
      "did:plc:abc",
      `${PLC}a`,
      "did:plc:ABCDEFGHIJKLMNOPQRSTUVWX",
      "did:web:example.com%3A8443",
      "did:web:Example.com",
      "did:web:example.com:user",
      "did:web:localhost",
      "did:key:z6Mk",
    ]) {
      expect(await asWeb(`SELECT '${bad}'::types.did`), bad).toBe("23514");
    }
  });

  test("at_uri_domain_check", async () => {
    const uri = `at://${PLC}/sh.unset.video/3k`;
    expect(await asWeb(`SELECT '${uri}'::types.at_uri`)).toBe("ok");
    expect(await asWeb(`SELECT 'at://${PLC}'::types.at_uri`)).toBe("ok");
    const authority = await rows<{ did: string }>(poolFor("unset"), `SELECT types.at_uri_did('${uri}') AS did`);
    expect(authority).toEqual([{ did: PLC }]);
    for (const bad of [
      "at://alice.example/sh.unset.video/3k",
      "at://did:plc:abc/sh.unset.video/3k",
      `at://${PLC}/a/b/c`,
      `https://${PLC}/sh.unset.video/3k`,
    ]) {
      expect(await asWeb(`SELECT '${bad}'::types.at_uri`), bad).toBe("23514");
    }
  });
});
