// P1.15m (infrastructure/postgres/migrations/0007_audit.sql): the audit lanes against real Postgres, connected as the
// roles that write them (TE-2): admin, web and indexer call audit.append; nobody writes the tables directly; the
// owner cannot rewrite them; the row hash matches a vector computed outside Postgres.
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
  as = { web: poolAs("web"), indexer: poolAs("indexer", 8), admin: poolAs("admin") };
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

const ACTOR = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
type Append = {
  action: string;
  outcome?: string;
  actorDid?: string | null;
  actorKey?: string | null;
  target?: string | null;
  reason?: string | null;
  pii?: object | null;
};

/** One audit.append call by `role`, in its own transaction. */
const append = (role: Writer, a: Append) =>
  withClient(as[role], null, async (client) => {
    const { rows } = await client.query<{ lane: string; seq: string; row_hash: Buffer }>(
      "SELECT * FROM audit.append($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, NULL, $7)",
      [
        a.action,
        a.outcome ?? "succeeded",
        a.actorDid ?? null,
        a.actorKey ?? null,
        a.target ?? null,
        a.reason ?? null,
        a.pii === undefined || a.pii === null ? null : JSON.stringify(a.pii),
      ],
    );
    return { lane: rows[0]?.lane, seq: Number(rows[0]?.seq) };
  });
const query = (role: Writer, text: string) => withClient(as[role], null, (client) => client.query(text));
/** As the owner, through the superuser's local socket (audit_owner never logs in). */
const asOwner = (text: string) => postgres.sql("unset", `SET ROLE audit_owner; ${text}`).replace(/^SET\n?/, "");
const count = (table: string) => Number(postgres.sql("unset", `SELECT count(*) FROM audit.${table}`));

describe("audit lanes", () => {
  test("append_as_admin", async () => {
    const before = count("chain");
    const { lane, seq } = await append("admin", {
      action: "mod.takedown",
      actorDid: ACTOR,
      actorKey: "credential-id",
      target: TARGET,
      reason: "spam",
    });
    expect(lane).toBe("mod");
    expect(count("chain")).toBe(before + 1);
    const where = `lane = 'mod' AND seq = ${seq}`;
    expect(postgres.sql("unset", `SELECT writer, action, retention_class FROM audit.chain WHERE ${where}`)).toBe(
      "admin|mod.takedown|mod_action",
    );
    const body = JSON.parse(postgres.sql("unset", `SELECT body_text FROM audit.event_body WHERE ${where}`));
    expect(body).toMatchObject({ actor: ACTOR, actor_key: "credential-id", target: TARGET, writer: "admin" });
    expect(postgres.sql("unset", `SELECT subject FROM audit.event_body WHERE ${where}`)).toBe(TARGET);
    // The MAC covers the stored text, and the stored row hash is the one audit.row_hash computes from the row.
    const checks = asOwner(
      "SELECT b.body_mac_ok, c.row_hash = audit.row_hash(c.lane, c.seq, c.ts, c.action, c.writer, c.retention_class, " +
        "c.prev_hash, c.body_mac, c.pii_mac) FROM audit.chain c, LATERAL (SELECT public.hmac(convert_to(e.body_text, " +
        "'UTF8'), e.k_body, 'sha256') = c.body_mac AS body_mac_ok FROM audit.event_body e WHERE (e.lane, e.seq) = " +
        `(c.lane, c.seq)) b WHERE c.${where}`,
    );
    expect(checks).toBe("t|t");
  });

  test("writer_denied", async () => {
    const before = count("chain");
    await expect(append("web", { action: "mod.takedown", target: TARGET })).rejects.toMatchObject({
      code: "UA002",
      message: "audit_writer_denied",
    });
    expect(count("chain")).toBe(before);
  });

  test("unknown_action", async () => {
    // Member sign-ins are never audited (plan section 6; Alex answer P1a-A2): the action does not exist.
    await expect(append("web", { action: "user.session_created" })).rejects.toMatchObject({
      code: "UA001",
      message: "audit_unknown_action",
    });
  });

  test("unknown_reason", async () => {
    const takedown = { action: "mod.takedown", actorDid: ACTOR, target: TARGET };
    await expect(append("admin", { ...takedown, reason: "because" })).rejects.toMatchObject({ code: "UA003" });
    await expect(append("admin", { ...takedown, reason: "harmful-abusive-material" })).resolves.toMatchObject({
      lane: "mod",
    });
    await expect(append("admin", { ...takedown, outcome: "maybe" })).rejects.toMatchObject({ code: "UA003" });
  });

  test("no_direct_insert", async () => {
    const insert =
      "INSERT INTO audit.chain VALUES ('sec', 999, now(), 'report.submitted', 'web', 'security', " +
      "'\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)";
    for (const role of WRITERS) await expect(query(role, insert), role).rejects.toMatchObject({ code: "42501" });
    for (const table of ["event_body", "event_pii", "actions", "reasons"])
      await expect(query("admin", `SELECT * FROM audit.${table}`), table).rejects.toMatchObject({ code: "42501" });
  });

  test("append_only", async () => {
    await append("indexer", { action: "index.account_state", target: TARGET });
    // One statement-level trigger per table refuses every UPDATE, DELETE and TRUNCATE, even one that matches no row.
    for (const statement of [
      "UPDATE audit.chain SET writer = 'web'",
      "UPDATE audit.chain SET writer = 'web' WHERE false",
      "DELETE FROM audit.chain",
      "TRUNCATE audit.chain CASCADE",
      "UPDATE audit.event_body SET body_text = '{}'",
      "DELETE FROM audit.event_body",
      "UPDATE audit.event_pii SET pii_text = '{}'",
      "TRUNCATE audit.event_pii",
    ])
      expect(() => asOwner(statement), statement).toThrow(/audit is append-only/);
  });

  test("pii_only_admin", async () => {
    const reveal = { action: "pii.email_reveal", actorDid: ACTOR, target: TARGET, reason: "support_request" };
    await expect(
      append("web", { action: "report.submitted", pii: { tailnet_ip: "100.64.1.2" } }),
    ).rejects.toMatchObject({ code: "UA003" });
    const { seq } = await append("admin", { ...reveal, pii: { tailnet_ip: "100.64.1.2" } });
    expect(
      postgres.sql("unset", `SELECT subject, pii_text FROM audit.event_pii WHERE lane = 'mod' AND seq = ${seq}`),
    ).toBe(`${ACTOR}|{"tailnet_ip": "100.64.1.2"}`);
    await expect(append("admin", { ...reveal, pii: { tailnet_ip: "fd7a:115c:a1e0::1" } })).resolves.toBeTruthy();
    for (const pii of [
      { tailnet_ip: "203.0.113.9" },
      { ip: "100.64.1.2" },
      { tailnet_ip: "not an address" },
      ["100.64.1.2"],
    ])
      await expect(append("admin", { ...reveal, pii }), JSON.stringify(pii)).rejects.toMatchObject({ code: "UA003" });
    // PII needs the actor it belongs to.
    await expect(
      append("admin", { ...reveal, actorDid: null, pii: { tailnet_ip: "100.64.1.2" } }),
    ).rejects.toMatchObject({ code: "UA003" });
  });

  test("concurrent_appends", async () => {
    // 20 transactions at once over 8 connections (indexer's limit is 10): the lane lock serialises them.
    const before = Number(postgres.sql("unset", "SELECT coalesce(max(seq), 0) FROM audit.chain WHERE lane = 'sec'"));
    const results = await Promise.all(
      Array.from({ length: 20 }, () => append("indexer", { action: "index.account_state", target: TARGET })),
    );
    expect(results.map((r) => r.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => before + i + 1),
    );
    // Every link in the lane: seqs 1..n, each prev_hash the previous row's hash (zeros at genesis), each hash recomputes.
    const broken = asOwner(
      "SELECT seq FROM (SELECT c.*, lag(c.row_hash, 1, '\\x" +
        "00".repeat(32) +
        "'::bytea) OVER (ORDER BY seq) AS expected_prev, row_number() OVER (ORDER BY seq) AS n FROM audit.chain c " +
        "WHERE lane = 'sec') x WHERE seq <> n OR prev_hash <> expected_prev OR row_hash <> audit.row_hash(lane, seq, " +
        "ts, action, writer, retention_class, prev_hash, body_mac, pii_mac)",
    );
    expect(broken).toBe("");
  });

  test("audit_flood_does_not_block", { timeout: 60_000 }, async () => {
    // web's user_triggered cap is 300 a minute; an operator append by admin is a different writer and class.
    for (let i = 0; i < 300; i++) await append("web", { action: "report.submitted", target: TARGET });
    await expect(append("web", { action: "report.submitted", target: TARGET })).rejects.toMatchObject({
      code: "UA004",
      message: "audit_rate_limited",
    });
    await expect(append("admin", { action: "mod.delist", actorDid: ACTOR, target: TARGET })).resolves.toMatchObject({
      lane: "mod",
    });
  });

  test("row_hash_known_answer", () => {
    const hex = (key: string) => `'\\x${vector[key]}'::bytea`;
    const computed = asOwner(
      `SELECT encode(audit.row_hash('${vector.lane}', ${vector.seq}, '${vector.ts}'::timestamptz, '${vector.action}', ` +
        `'${vector.writer}', '${vector.retentionClass}', ${hex("prevHash")}, ${hex("bodyMac")}, ${hex("piiMac")}), 'hex')`,
    );
    expect(computed).toBe(vector.rowHash);
  });

  test("registry_rows", () => {
    for (const column of ["audit.event_body.subject", "audit.event_pii.subject"])
      expect(registry[column]?.strategy, column).toBe("audit_redact");
  });
});
