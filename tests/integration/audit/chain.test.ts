// P1.15s: appendAudit and verifyChain (infrastructure/audit, P1.15) against real Postgres with migrations 0008 to
// 0010, connected as the roles that use them (TE-2). The writers append through the TS entry point; auditor runs the
// daily `links` check, which reads the chain only; the owner's `full` check also reads the body rows.
//
// Like tests/integration/postgres/audit.test.ts it runs on its own container: it needs admin and auditor, which the
// shared cluster does not hand out, and a superuser to tamper with rows behind the triggers.
import { join } from "node:path";
import { parseDid } from "@unset/domains-identity";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_REASONS,
  AuditError,
  type AuditEvent,
  appendAudit,
  verifyChain,
} from "../../../infrastructure/audit/index.ts";
import {
  createPool,
  migrate,
  type Pool,
  type PoolClient,
  withClient,
  withTransaction,
} from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const ROLES = ["web", "admin", "auditor"] as const;
type Role = (typeof ROLES)[number];
const migratorPassword = randomPassword();
const passwords = Object.fromEntries(ROLES.map((role) => [role, randomPassword()])) as Record<Role, string>;
const pools: Pool[] = [];
let postgres: PostgresContainer;
let as: Record<Role, Pool>;
let statements = 0;

const did = (raw: string) => parseDid(raw) ?? expect.fail(`not a DID: ${raw}`);
const ACTOR = did("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa");
const TARGET = did("did:plc:bbbbbbbbbbbbbbbbbbbbbbbb");

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
  for (const role of ROLES) postgres.sql("postgres", `ALTER ROLE ${role} PASSWORD '${passwords[role]}'`);
  as = { web: poolAs("web"), admin: poolAs("admin"), auditor: poolAs("auditor") };
}, 120_000);
afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.close()));
  stopAllPostgres();
});

function poolAs(role: Role): Pool {
  const pool = createPool({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      database: "unset",
      user: role,
      password: passwords[role],
      ssl: false,
    },
    service: "audit-chain-test",
    max: 1,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 10_000,
    idleInTransactionTimeoutMs: 10_000,
    onStatement: () => {
      statements += 1;
    },
  });
  pools.push(pool);
  return pool;
}

const append = (role: "web" | "admin", event: AuditEvent) =>
  withTransaction(as[role], null, (client) => appendAudit(client, event));
/**
 * A superuser edit behind the triggers: `session_replication_role` is superuser-only, so this is the strongest attacker
 * the chain is meant to expose. An owner's own edit (DISABLE TRIGGER) is tamper_as_owner_disable_trigger_detected.
 */
const tamper = (statement: string) =>
  postgres.sql("unset", `BEGIN; SET LOCAL session_replication_role = replica; ${statement}; COMMIT;`);
const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);

describe("audit chain", () => {
  test("reason_union_matches_table", () => {
    expect(lines("SELECT reason FROM audit.reasons ORDER BY reason")).toEqual([...AUDIT_REASONS].sort());
    const actions = Object.entries(AUDIT_ACTIONS).map(([action, lane]) => `${action}|${lane}`);
    expect(lines("SELECT action || '|' || lane FROM audit.actions ORDER BY action")).toEqual(actions.sort());
  });

  test("typed_append_rejects_free_text", async () => {
    const takedown: AuditEvent = { action: "mod.takedown", outcome: "succeeded", actorDid: ACTOR, target: TARGET };
    const free: Record<string, unknown>[] = [
      { reason: "alice@example.com" },
      { reason: "192.0.2.10" },
      { jti: "eyJhbGciOiJIUzI1NiJ9.e30.c2ln" },
      { target: "alice@example.com" },
      { target: "192.0.2.10" },
      { actorKey: "key with spaces" },
      { outcome: "maybe" },
      { receipt: new Uint8Array(31) },
      { case: "not-a-uuid" },
      { action: "user.session_created" },
    ];
    const before = statements;
    for (const field of free) {
      const event = { ...takedown, ...field } as AuditEvent;
      await expect(
        withClient(as.admin, null, (client) => appendAudit(client, event)),
        JSON.stringify(field),
      ).rejects.toThrow(new AuditError("audit.bad_input"));
    }
    expect(statements - before, "validation runs before any SQL").toBe(0);
    expect(lines("SELECT count(*) FROM audit.chain")).toEqual(["0"]);
  });

  test("chain_links", async () => {
    const results: { lane: string; seq: number }[] = [];
    for (let i = 0; i < 50; i++) {
      results.push(await append("web", { action: "report.submitted", outcome: "succeeded", target: TARGET }));
      results.push(
        await append("admin", {
          action: "mod.takedown",
          outcome: "attempted",
          actorDid: ACTOR,
          actorKey: "credential-id",
          target: TARGET,
          reason: "spam",
        }),
      );
    }
    const seqs = (lane: string) => results.filter((r) => r.lane === lane).map((r) => r.seq);
    expect(seqs("sec")).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(seqs("mod")).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    for (const lane of ["sec", "mod"] as const) {
      await expect(withClient(as.auditor, null, (client) => verifyChain(client, lane, "links"))).resolves.toEqual({
        ok: true,
        last: 50,
      });
      await expect(verifyAsOwner(lane, "full")).resolves.toEqual({ ok: true, last: 50 });
    }
  });

  test("tamper_chain_metadata", async () => {
    tamper("UPDATE audit.chain SET retention_class = 'pii_admin' WHERE lane = 'sec' AND seq = 7");
    await expect(withClient(as.auditor, null, (client) => verifyChain(client, "sec", "links"))).resolves.toEqual({
      ok: false,
      badSeq: 7,
      reason: "hash",
    });
    tamper("UPDATE audit.chain SET retention_class = 'security' WHERE lane = 'sec' AND seq = 7");
    tamper("DELETE FROM audit.chain WHERE lane = 'sec' AND seq = 9");
    await expect(withClient(as.auditor, null, (client) => verifyChain(client, "sec", "links"))).resolves.toEqual({
      ok: false,
      badSeq: 10,
      reason: "gap",
    });
  });

  test("tamper_body", async () => {
    tamper(
      `UPDATE audit.event_body SET body_text = replace(body_text, 'spam', 'harassment') WHERE lane = 'mod' AND seq = 3`,
    );
    await expect(verifyAsOwner("mod", "full")).resolves.toEqual({ ok: false, badSeq: 3, reason: "body_mac" });
    // The daily check reads the chain only, so it cannot see a body edit: the weekly `full` run is what catches it.
    await expect(withClient(as.auditor, null, (client) => verifyChain(client, "mod", "links"))).resolves.toEqual({
      ok: true,
      last: 50,
    });
    // A redacted (missing) body row is fine.
    tamper("DELETE FROM audit.event_body WHERE lane = 'mod' AND seq = 3");
    await expect(verifyAsOwner("mod", "full")).resolves.toEqual({ ok: true, last: 50 });
  });

  test("tamper_as_owner_disable_trigger_detected", async () => {
    // What the owner could do: it owns the tables, so it may switch the append-only trigger off around an edit.
    await asOwner(async (client) => {
      await client.query("BEGIN");
      await client.query("ALTER TABLE audit.event_body DISABLE TRIGGER event_body_append_only");
      await client.query(
        "UPDATE audit.event_body SET body_text = replace(body_text, 'spam', 'other') WHERE lane = 'mod' AND seq = 5",
      );
      await client.query("ALTER TABLE audit.event_body ENABLE TRIGGER event_body_append_only");
      await client.query("COMMIT");
    });
    await expect(verifyAsOwner("mod", "full")).resolves.toEqual({ ok: false, badSeq: 5, reason: "body_mac" });
  });

  test("verifier_login_role_needs_set_role", async () => {
    // NOINHERIT: the login role holds none of the owner's rights until it says SET ROLE (architecture record
    // 2026-10-07-p115b-keep-set-role, as migrator holds audit_owner in 0003).
    await withClient(owner(), null, async (client) => {
      await expect(client.query("SELECT count(*) FROM audit.event_body")).rejects.toThrow(/permission denied/);
      await client.query("SET ROLE audit_owner");
      const { rows } = await client.query("SELECT current_user AS who, count(*)::int AS n FROM audit.event_body");
      await client.query("RESET ROLE");
      expect(rows[0]).toMatchObject({ who: "audit_owner" });
    });
  });

  test("verifier_without_set_role_is_denied", async () => {
    await expect(withClient(owner(), null, (client) => verifyChain(client, "mod", "links"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

/**
 * The weekly `full` run's shape (admin design 7.3): a login role that is a NOINHERIT member of audit_owner, the body
 * rows' only reader, and runs SET ROLE audit_owner before anything else. audit_owner itself stays NOLOGIN.
 */
let ownerPool: Pool | undefined;
function owner(): Pool {
  if (ownerPool === undefined) {
    const password = randomPassword();
    postgres.sql(
      "postgres",
      `CREATE ROLE audit_verifier LOGIN NOINHERIT PASSWORD '${password}'; ` +
        "GRANT audit_owner TO audit_verifier WITH INHERIT FALSE, SET TRUE; GRANT CONNECT ON DATABASE unset TO audit_verifier",
    );
    ownerPool = createPool({
      connection: {
        host: "127.0.0.1",
        port: postgres.port,
        database: "unset",
        user: "audit_verifier",
        password,
        ssl: false,
      },
      service: "audit-chain-test",
      max: 1,
      connectTimeoutMs: 5000,
      statementTimeoutMs: 10_000,
      idleInTransactionTimeoutMs: 10_000,
    });
    pools.push(ownerPool);
  }
  return ownerPool;
}

/** Runs `fn` as audit_owner through the verifier's SET ROLE, and resets the role before the client goes back. */
function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(owner(), null, async (client) => {
    await client.query("SET ROLE audit_owner");
    try {
      return await fn(client);
    } finally {
      await client.query("RESET ROLE");
    }
  });
}

const verifyAsOwner = (lane: "mod" | "sec", mode: "links" | "full") =>
  asOwner((client) => verifyChain(client, lane, mode));
