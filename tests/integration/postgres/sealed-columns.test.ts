// P1.14d (migration 0007, infrastructure/postgres/sealed-columns.json, sealedColumns.ts, rewrapAll.ts): every
// `types.sealed` column has a registry row, every row with a `form` names a real non-sealed text or bytea column, and
// `rewrapAll` moves every registered value to the active key (step book P1.14, tests rewrap_all_counts and
// sealed_columns_registry). The catalog is the list, as for DID columns (P1.13 method).
//
// It runs on its own container through tests/support/postgres.ts, like did-columns.test.ts: each case adds tables as
// migrator in a throwaway database, and the domain check and the rewrap run as `web`, the role that writes.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createSealer, type Keyring, parseKeyring, sealContext } from "@unset/infrastructure-seal";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  checkExit,
  createPool,
  kidCounts,
  migrate,
  type Pool,
  rewrapAll,
  SEALED_COLUMNS,
  type SealedRegistry,
  sealedColumns,
  withClient,
} from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const POSTGRES = join(REPOSITORY, "infrastructure", "postgres");
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
    service: "sealed-columns-test",
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
async function migratedWith(sql: string): Promise<string> {
  const name = `s_${randomBytes(6).toString("hex")}`;
  postgres.sql("postgres", `CREATE DATABASE ${name} OWNER migrator`);
  postgres.sql(name, `REVOKE ALL ON DATABASE ${name} FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC`);
  await migrateInto(name);
  await withClient(poolFor(name), null, (client) => client.query(sql));
  return name;
}

/** Each problem between the catalog and `registry`, one readable line each. */
async function registryProblems(pool: Pool, registry: SealedRegistry = SEALED_COLUMNS): Promise<string[]> {
  const catalog = await sealedColumns(pool);
  const sealed = catalog.filter((c) => c.type === "sealed").map((c) => c.key);
  const plain = new Set(catalog.filter((c) => c.type === "text" || c.type === "bytea").map((c) => c.key));
  const entries = Object.entries(registry);
  // rewrapAll writes a value back by its row key, so the row key must be unique on its own (primary key or unique).
  const unique = new Set(
    (
      await withClient(pool, null, (client) =>
        client.query<{ key: string }>(
          `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS key
             FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
                  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
            WHERE i.indisunique AND i.indnkeyatts = 1 AND i.indpred IS NULL`,
        ),
      )
    ).rows.map((r) => r.key),
  );
  const tableOf = (key: string) => key.split(".").slice(0, 2).join(".");
  return [
    ...sealed.filter((key) => !(key in registry)).map((key) => `add a sealed-columns row for ${key}`),
    ...entries
      .filter(([key, row]) => row.form === undefined && !sealed.includes(key))
      .map(([key]) => `${key} is registered but is not a types.sealed column`),
    ...entries
      .filter(([key, row]) => row.form !== undefined && !plain.has(key))
      .map(([key, row]) => `${key} (${row.form}) is not a text or bytea column`),
    ...entries
      .filter(([key, row]) => (sealed.includes(key) || plain.has(key)) && !unique.has(`${tableOf(key)}.${row.rowKey}`))
      .map(([key, row]) => `${key}: row key ${row.rowKey} is not unique on its own`),
  ];
}

const keyring = (active: string, kids: readonly string[]): Keyring =>
  parseKeyring(
    JSON.stringify({
      active,
      // Each kid has the same key in every keyring, as a real rotation keeps the old keys.
      keys: Object.fromEntries(kids.map((kid) => [kid, Buffer.alloc(32, kid).toString("base64")])),
    }),
  ) as Keyring;

/** The SQLSTATE a statement fails with as `web`, or "ok". */
async function asWeb(database: string, sql: string): Promise<string> {
  try {
    await withClient(poolFor(database, "web", webPassword), null, (client) => client.query(sql));
    return "ok";
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
}

describe("sealed columns", () => {
  test("registry_complete", async () => {
    expect(await registryProblems(poolFor("unset"))).toEqual([]);
  });

  test("sealed_columns_registry", async () => {
    const database = await migratedWith(
      "CREATE TABLE app.t (id text PRIMARY KEY, secret types.sealed, media_key text, blob bytea, n int, owner text)",
    );
    const pool = poolFor(database);
    expect(await registryProblems(pool)).toEqual(["add a sealed-columns row for app.t.secret"]);
    expect(await registryProblems(pool, { "app.t.secret": { rowKey: "id" } })).toEqual([]);
    expect(
      await registryProblems(pool, {
        "app.t.secret": { rowKey: "id" },
        "app.t.gone": { rowKey: "id", form: "sealToStream" },
        "app.t.n": { rowKey: "id", form: "sealTo" },
        "app.t.media_key": { rowKey: "id", form: "sealStream" },
        "app.t.blob": { rowKey: "id", form: "sealTo" },
        "app.t.id": { rowKey: "id" },
      }),
    ).toEqual([
      "app.t.id is registered but is not a types.sealed column",
      "app.t.gone (sealToStream) is not a text or bytea column",
      "app.t.n (sealTo) is not a text or bytea column",
    ]);
    expect(await registryProblems(pool, { "app.t.secret": { rowKey: "owner" } })).toEqual([
      "app.t.secret: row key owner is not unique on its own",
    ]);
    // A types.sealed column registered with a form is refused: a form row names a text or bytea column only.
    expect(await registryProblems(pool, { "app.t.secret": { rowKey: "id", form: "sealTo" } })).toEqual([
      "app.t.secret (sealTo) is not a text or bytea column",
    ]);
  });

  test("sealed_domain_check", async () => {
    const value = createSealer(keyring("k1", ["k1"])).seal(Buffer.from("x"), sealContext("app.t.c", "1"));
    expect(await asWeb("unset", `SELECT '${value}'::types.sealed`)).toBe("ok");
    for (const bad of ["plain", "s1..x", "s1.K1.x", "s1.abcdefghijklmnopq.x", "a1.k1.x", "s1c.k1.x"]) {
      expect(await asWeb("unset", `SELECT '${bad}'::types.sealed`), bad).toBe("23514");
    }
  });

  test("rewrap_all_counts", async () => {
    const database = await migratedWith(
      "CREATE TABLE app.r (id text PRIMARY KEY, secret types.sealed, other types.sealed);" +
        " GRANT SELECT (id, secret, other), UPDATE (secret, other) ON app.r TO web",
    );
    const registry: SealedRegistry = { "app.r.secret": { rowKey: "id" }, "app.r.other": { rowKey: "id" } };
    const before = createSealer(keyring("k1", ["k1"]));
    const values = ["1", "2", "3"].map((id) => [id, before.seal(Buffer.from(id), sealContext("app.r.secret", id))]);
    await withClient(poolFor(database), null, (client) =>
      client.query(`INSERT INTO app.r (id, secret) SELECT * FROM unnest($1::text[], $2::text[])`, [
        values.map(([id]) => id),
        values.map(([, value]) => value),
      ]),
    );
    const web = poolFor(database, "web", webPassword);
    expect(await kidCounts(web, registry)).toEqual({ k1: 3 });
    expect(checkExit(await kidCounts(web, registry), "k1")).toBe(1);

    expect(await rewrapAll(web, keyring("k2", ["k1", "k2"]), { registry, batchSize: 2 })).toEqual({ k1: 0, k2: 3 });
    expect(await kidCounts(web, registry)).toEqual({ k2: 3 });
    expect(checkExit(await kidCounts(web, registry), "k1")).toBe(0);
    // A second run finds nothing left to move.
    expect(await rewrapAll(web, keyring("k2", ["k1", "k2"]), { registry })).toEqual({ k2: 3 });
    const rows = await withClient(
      web,
      null,
      async (client) => (await client.query("SELECT id, secret FROM app.r")).rows,
    );
    const only = createSealer(keyring("k2", ["k2"]));
    for (const row of rows as { id: string; secret: string }[]) {
      expect(row.secret.startsWith("s1.k2.")).toBe(true);
      expect(Buffer.from(only.unseal(row.secret, sealContext("app.r.secret", row.id))).toString()).toBe(row.id);
    }
  });
});
