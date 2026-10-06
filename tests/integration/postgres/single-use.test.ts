// P1.16 (infrastructure/postgres/singleUse/store.ts, migration 0006): the durable single-use store against real
// Postgres, connected as the roles that use it (TE-2): web issues, consumes and claims; retention sweeps.
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { createLogger, type LogEvent, type LogFields, type Logger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";
import {
  createPool,
  createSingleUseStore,
  type Db,
  type ExternalId,
  type Pool,
  type Purpose,
  withClient,
} from "../../../infrastructure/postgres/index.ts";
import type { ProcessRole } from "../setup/pg.setup.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const pools: Pool[] = [];
const poolAs = (role: ProcessRole, max = 1): Pool => {
  const pool = createPool({
    connection: { host: provided.host, port: provided.port, ...provided.roles[role], database, ssl: false },
    service: "single-use-test",
    max,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 5000,
    idleInTransactionTimeoutMs: 5000,
  });
  pools.push(pool);
  return pool;
};
const web = poolAs("web", 10);
const retention = poolAs("retention");
afterAll(() => Promise.all(pools.map((pool) => pool.close())));

const DID_A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const DID_B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";

/** A store whose log lines land in `logged`, and a way to run one call on a web client. */
function setup() {
  const logged: { event: LogEvent; fields: LogFields }[] = [];
  const record = (event: LogEvent, fields: LogFields = {}) => {
    logged.push({ event, fields });
  };
  const log: Logger = { info: record, warn: record, error: record, logError: () => undefined };
  const store = createSingleUseStore({ log });
  const onWeb = <T>(fn: (db: Db) => Promise<T>): Promise<T> => withClient(web, null, fn);
  return { store, logged, onWeb };
}

const sql = <T extends Record<string, unknown>>(pool: Pool, text: string, values: unknown[] = []) =>
  withClient(pool, null, async (client) => (await client.query<T>(text, values)).rows);

describe("single-use store", () => {
  test("issue_consume_ok", async () => {
    const { store, onWeb } = setup();
    const token = await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60 }));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await onWeb((db) => store.consume(db, "login.nonce", token))).toBe("ok");
  });

  test("consume_twice", async () => {
    const { store, logged, onWeb } = setup();
    const token = await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60 }));
    await onWeb((db) => store.consume(db, "login.nonce", token));
    expect(await onWeb((db) => store.consume(db, "login.nonce", token))).toBe("invalid");
    expect(logged).toEqual([{ event: "single_use.rejected", fields: { reason: "reused", kind: "login_nonce" } }]);
  });

  test("concurrent_consume", async () => {
    const { store, onWeb } = setup();
    const token = await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60 }));
    const results = await Promise.all(
      Array.from({ length: 10 }, () => onWeb((db) => store.consume(db, "login.nonce", token))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
  });

  test("expired", async () => {
    const { store, logged, onWeb } = setup();
    // An expiry in the past, written as web through the columns it may insert.
    const token = Buffer.alloc(32, 5);
    await sql(
      web,
      "INSERT INTO app.single_use (id, purpose, expires_at) VALUES ($1, $2, now() - interval '1 second')",
      [createHash("sha256").update(token).digest(), "login.nonce"],
    );
    expect(await onWeb((db) => store.consume(db, "login.nonce", token.toString("base64url")))).toBe("invalid");
    expect(logged.map((l) => l.fields.reason)).toEqual(["expired"]);
  });

  test("purpose_mismatch", async () => {
    const { store, logged, onWeb } = setup();
    const token = await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60 }));
    expect(await onWeb((db) => store.consume(db, "module.assertion", token))).toBe("invalid");
    expect(logged).toEqual([
      { event: "single_use.rejected", fields: { reason: "purpose_mismatch", kind: "module_assertion" } },
    ]);
    expect(await onWeb((db) => store.consume(db, "login.nonce", token))).toBe("ok");
  });

  test("bind_mismatch_keeps_token", async () => {
    const { store, logged, onWeb } = setup();
    const extra = Buffer.from("cookie-binding");
    const token = await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60, bindDid: DID_A, bindExtra: extra }));
    expect(await onWeb((db) => store.consume(db, "login.nonce", token, { bindDid: DID_B, bindExtra: extra }))).toBe(
      "invalid",
    );
    expect(await onWeb((db) => store.consume(db, "login.nonce", token, { bindDid: DID_A }))).toBe("invalid");
    expect(logged.map((l) => l.fields.reason)).toEqual(["bind_mismatch", "bind_mismatch"]);
    expect(await onWeb((db) => store.consume(db, "login.nonce", token, { bindDid: DID_A, bindExtra: extra }))).toBe(
      "ok",
    );
  });

  test("malformed_token", async () => {
    const { store, logged } = setup();
    let queries = 0;
    const counting = { query: () => queries++ } as unknown as Db;
    for (const bad of ["abc", "", "A".repeat(44), `${"A".repeat(42)}B`, `${"A".repeat(42)}+`]) {
      expect(await store.consume(counting, "login.nonce", bad), bad).toBe("invalid");
    }
    expect(queries).toBe(0);
    expect(new Set(logged.map((l) => l.fields.reason))).toEqual(new Set(["unknown"]));
    // A well-formed token that was never issued is unknown too.
    const { store: fresh, logged: freshLog, onWeb } = setup();
    expect(await onWeb((db) => fresh.consume(db, "login.nonce", Buffer.alloc(32, 9).toString("base64url")))).toBe(
      "invalid",
    );
    expect(freshLog.map((l) => l.fields.reason)).toEqual(["unknown"]);
  });

  test("token_not_stored", async () => {
    const { store, onWeb } = setup();
    const token = await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60, bindDid: DID_A }));
    const raw = Buffer.from(token, "base64url");
    const rows = await sql<{ id: Buffer; purpose: string; bind_did: string | null; bind_extra: Buffer | null }>(
      web,
      "SELECT id, purpose, bind_did, bind_extra FROM app.single_use",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (value === null) continue;
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
        expect(bytes.includes(raw)).toBe(false);
        expect(String(value).includes(token)).toBe(false);
      }
    }
    expect(rows.some((r) => r.id.equals(createHash("sha256").update(raw).digest()))).toBe(true);
  });

  test("ttl_cap", async () => {
    const { store, onWeb } = setup();
    await expect(onWeb((db) => store.issue(db, "module.assertion", { ttlS: 600 }))).rejects.toThrow(RangeError);
    for (const ttlS of [0, -1, 1.5]) {
      await expect(onWeb((db) => store.issue(db, "login.nonce", { ttlS }))).rejects.toThrow(RangeError);
    }
    await expect(onWeb((db) => store.issue(db, "module.assertion", { ttlS: 120 }))).resolves.toMatch(/^[\w-]{43}$/);
  });

  test("issue_retries_one_collision", async () => {
    const { onWeb } = setup();
    const repeated = Buffer.alloc(32, 7);
    const queue = [repeated, repeated, Buffer.alloc(32, 8)];
    const log = createLogger({ service: "http", commit: "0".repeat(40), env: "test", write: () => undefined });
    const store = createSingleUseStore({ log, random: () => queue.shift() as Buffer });
    expect(await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60 }))).toBe(repeated.toString("base64url"));
    expect(await onWeb((db) => store.issue(db, "login.nonce", { ttlS: 60 }))).toBe(
      Buffer.alloc(32, 8).toString("base64url"),
    );
    const twice = createSingleUseStore({ log, random: () => repeated });
    await expect(onWeb((db) => twice.issue(db, "login.nonce", { ttlS: 60 }))).rejects.toMatchObject({ code: "23505" });
  });

  test("claim_once", async () => {
    const { store, onWeb } = setup();
    const id = { issuer: "did:web:issuer.example", externalId: "jti-1" };
    const later = new Date(Date.now() + 60_000);
    expect(await onWeb((db) => store.claim(db, "service_auth.jti", id, later))).toBe(true);
    expect(await onWeb((db) => store.claim(db, "service_auth.jti", id, later))).toBe(false);
    const racing = { issuer: "did:web:issuer.example", externalId: "jti-2" };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => onWeb((db) => store.claim(db, "service_auth.jti", racing, later))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("claim_scoped_by_issuer", async () => {
    const { store, onWeb } = setup();
    const later = new Date(Date.now() + 60_000);
    const claim = (issuer: string, externalId: string) =>
      onWeb((db) => store.claim(db, "service_auth.jti", { issuer, externalId }, later));
    expect(await claim("did:web:a.example", "j")).toBe(true);
    expect(await claim("did:web:b.example", "j")).toBe(true);
    // Colons in an issuer cannot make two different ids one key.
    expect(await claim("did:web:c.example:x", "y")).toBe(true);
    expect(await claim("did:web:c.example", "x:y")).toBe(true);
  });

  test("claim_key_vector", async () => {
    // Architecture record p116, Amendment 20:15Z: the key is sha256 of the JSON array, pinned by a vector computed
    // independently (Python hashlib and json.dumps with compact separators).
    const { store, onWeb } = setup();
    const id = { issuer: "did:web:issuer.example", externalId: "jti-1" };
    await onWeb((db) => store.claim(db, "service_auth.jti", id, new Date(Date.now() + 60_000)));
    const rows = await sql<{ hex: string }>(web, "SELECT encode(id, 'hex') AS hex FROM app.single_use WHERE id = $1", [
      Buffer.from("cb21469d1aa86b10a4e302792f25a547ce390a9c5c6e4d749fec80d7f943413d", "hex"),
    ]);
    expect(rows).toHaveLength(1);
  });

  test("claim_refuses_bad_parts", async () => {
    // Each part is checked before any database call; nothing is normalised into a valid one.
    const { store } = setup();
    let queries = 0;
    const counting = { query: () => queries++ } as unknown as Db;
    const later = new Date(Date.now() + 60_000);
    const good = { issuer: "did:web:issuer.example", externalId: "jti-1" };
    const bad: [string, unknown][] = [
      ["no.such", good],
      ["service_auth.jti", { ...good, issuer: "https://issuer.example" }],
      ["service_auth.jti", { ...good, issuer: "did:web:issuer.example:" }],
      ["service_auth.jti", { ...good, issuer: "DID:web:issuer.example" }],
      ["service_auth.jti", { ...good, issuer: ` ${good.issuer}` }],
      ["service_auth.jti", { ...good, issuer: `did:web:${"a".repeat(2048)}` }],
      ["service_auth.jti", { ...good, issuer: 42 }],
      ["service_auth.jti", { ...good, externalId: "" }],
      ["service_auth.jti", { ...good, externalId: "has space" }],
      ["service_auth.jti", { ...good, externalId: "x".repeat(257) }],
      ["service_auth.jti", { ...good, externalId: "jtï" }],
      ["service_auth.jti", { ...good, externalId: ["jti-1"] }],
    ];
    for (const [purpose, id] of bad) {
      await expect(
        store.claim(counting, purpose as Purpose, id as ExternalId, later),
        JSON.stringify(id),
      ).rejects.toThrow(RangeError);
    }
    expect(queries).toBe(0);
  });

  test("claim_clamped", async () => {
    const { store, logged, onWeb } = setup();
    const id = { issuer: "did:web:issuer.example", externalId: "far" };
    const farAway = new Date(Date.now() + 86_400_000);
    expect(await onWeb((db) => store.claim(db, "module.assertion", id, farAway))).toBe(true);
    expect(logged).toEqual([{ event: "single_use.claim_clamped", fields: { kind: "module_assertion" } }]);
    const [row] = await sql<{ capped: boolean }>(
      web,
      "SELECT expires_at <= now() + interval '120 seconds' AS capped FROM app.single_use WHERE purpose = $1",
      ["module.assertion"],
    );
    expect(row?.capped).toBe(true);
  });

  test("sweep", async () => {
    const { store } = setup();
    const insert = (fill: number, age: string) =>
      sql(
        web,
        "INSERT INTO app.single_use (id, purpose, expires_at) VALUES ($1, 'login.nonce', now() - $2::interval)",
        [Buffer.alloc(32, fill), age],
      );
    await insert(20, "2 days");
    await insert(21, "1 hour");
    const swept = await withClient(retention, null, (db) => store.sweep(db));
    expect(swept).toBeGreaterThanOrEqual(1);
    const left = await sql<{ fill: number }>(
      web,
      "SELECT get_byte(id, 0) AS fill FROM app.single_use WHERE id = ANY($1)",
      [[Buffer.alloc(32, 20), Buffer.alloc(32, 21)]],
    );
    expect(left).toEqual([{ fill: 21 }]);
  });

  test("db_error_throws", async () => {
    const { store } = setup();
    const failing = { query: () => Promise.reject(new Error("connection lost")) } as unknown as Db;
    const token = Buffer.alloc(32, 1).toString("base64url");
    await expect(store.consume(failing, "login.nonce", token)).rejects.toThrow("connection lost");
    await expect(
      store.claim(failing, "service_auth.jti", { issuer: "did:web:issuer.example", externalId: "j" }, new Date()),
    ).rejects.toThrow("connection lost");
  });
});
