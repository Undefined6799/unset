// P1.15d (infrastructure/postgres/migrations/0008_audit.sql, 0009_audit_tables.sql): the audit lanes against real
// Postgres, connected as the roles that write them (TE-2): nobody writes the tables directly; the owner cannot rewrite
// them; the row hash matches a vector computed outside Postgres. P1.15g adds the appends once 0010 grants EXECUTE.
//
// It runs on its own container through tests/support/postgres.ts, like grants.test.ts: the cases need admin, which
// the shared cluster does not hand out, and the owner's view of the side tables.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPool, migrate, type Pool, withClient } from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const registry = readJson<Record<string, { strategy: string }>>(
  join(REPOSITORY, "infrastructure", "postgres", "erasure-registry.json"),
);
const vector = readJson<Record<string, string | number>>(join(import.meta.dirname, "audit-row-hash.vector.json"));

const WRITERS = ["web", "indexer", "admin"] as const;
type Writer = (typeof WRITERS)[number];
const migratorPassword = randomPassword();
const passwords = Object.fromEntries(WRITERS.map((role) => [role, randomPassword()])) as Record<Writer, string>;
const pools: Pool[] = [];
let postgres: PostgresContainer;
let as: Record<Writer, Pool>;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  const result = await migrate({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      database: "unset",
      user: "migrator",
      password: migratorPassword,
      ssl: false,
    },
    dir: join(REPOSITORY, "infrastructure", "postgres", "migrations"),
    root: REPOSITORY,
    log: createLogger({ service: "migrate", commit: "0".repeat(40), env: "test", write: () => undefined }),
    retryDelaysMs: [],
  });
  if (!result.ok) throw new Error(`migration failed: ${result.reason}`);
  for (const role of WRITERS) postgres.sql("postgres", `ALTER ROLE ${role} PASSWORD '${passwords[role]}'`);
  as = { web: poolAs("web"), indexer: poolAs("indexer"), admin: poolAs("admin") };
}, 120_000);
afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.close()));
  stopAllPostgres();
});

function poolAs(role: Writer, max = 1): Pool {
  const pool = createPool({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      database: "unset",
      user: role,
      password: passwords[role],
      ssl: false,
    },
    service: "audit-test",
    max,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 10_000,
    idleInTransactionTimeoutMs: 10_000,
  });
  pools.push(pool);
  return pool;
}

const query = (role: Writer, text: string) => withClient(as[role], null, (client) => client.query(text));
/** As the owner, through the superuser's local socket (audit_owner never logs in). */
const asOwner = (text: string) => postgres.sql("unset", `SET ROLE audit_owner; ${text}`).replace(/^SET\n?/, "");

describe("audit lanes", () => {
  test("append_has_no_pii_argument", () => {
    // Alex answered P1a-A1 "No address" (2026-10-07 00:14:42Z): the audit stores no personal field, so append takes none
    // (architecture record 2026-10-06-p115m-tailnet-pii-deferred, "Under B").
    expect(asOwner("SELECT pg_get_function_identity_arguments('audit.append'::regproc)")).toBe(
      "p_action text, p_outcome text, p_actor_did types.did, p_actor_key text, p_target types.did, p_reason text, " +
        "p_case uuid, p_jti text, p_request_id uuid, p_receipt bytea",
    );
  });

  test("no_direct_insert", async () => {
    const insert =
      "INSERT INTO audit.chain VALUES ('sec', 999, now(), 'report.submitted', 'web', 'security', " +
      "'\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)";
    for (const role of WRITERS) await expect(query(role, insert), role).rejects.toMatchObject({ code: "42501" });
    for (const table of ["event_body", "actions", "reasons"])
      await expect(query("admin", `SELECT * FROM audit.${table}`), table).rejects.toMatchObject({ code: "42501" });
  });

  test("append_only", async () => {
    // One statement-level trigger per table refuses every UPDATE, DELETE and TRUNCATE, even one that matches no row.
    for (const statement of [
      "UPDATE audit.chain SET writer = 'web'",
      "UPDATE audit.chain SET writer = 'web' WHERE false",
      "DELETE FROM audit.chain",
      "TRUNCATE audit.chain CASCADE",
      "UPDATE audit.event_body SET body_text = '{}'",
      "DELETE FROM audit.event_body",
      "TRUNCATE audit.event_body",
    ])
      expect(() => asOwner(statement), statement).toThrow(/audit is append-only/);
  });

  test("row_hash_known_answer", () => {
    const hex = (key: string) => `'\\x${vector[key]}'::bytea`;
    const computed = asOwner(
      `SELECT encode(audit.row_hash('${vector.lane}', ${vector.seq}, '${vector.ts}'::timestamptz, '${vector.action}', ` +
        `'${vector.writer}', '${vector.retentionClass}', ${hex("prevHash")}, ${hex("bodyMac")}), 'hex')`,
    );
    expect(computed).toBe(vector.rowHash);
  });

  test("registry_rows", () => {
    expect(registry["audit.event_body.subject"]?.strategy).toBe("audit_redact");
    expect(Object.keys(registry).filter((column) => column.startsWith("audit."))).toEqual(["audit.event_body.subject"]);
  });
});
