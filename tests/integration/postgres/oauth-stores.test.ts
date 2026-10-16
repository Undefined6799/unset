// P2.04 (infrastructure/postgres/oauthStores.ts, migration 0013): the OAuth client's state and session stores against
// real Postgres, connected as `web` (TE-2). What they store is sealed, bound to its row, and read back only before it
// expires; a row that does not open is deleted and reads as missing.
import { relative } from "node:path";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import type { LogEvent, LogFields, Logger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";
import {
  createOAuthSessionStore,
  createOAuthStateStore,
  createPool,
  type Pool,
  withClient,
} from "../../../infrastructure/postgres/index.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const web: Pool = createPool({
  connection,
  service: "oauth-stores-test",
  max: 4,
  connectTimeoutMs: 5000,
});
afterAll(() => web.end());

const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const sealer = createSealer(keyring);

const DID_A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const DID_B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
type Saved = { authMethod: { method: "private_key_jwt"; kid: string } | { method: "none" }; tokenSet: { a: string } };

function setup() {
  const logged: { event: LogEvent; fields: LogFields }[] = [];
  const record = (event: LogEvent, fields: LogFields = {}) => {
    logged.push({ event, fields });
  };
  const log: Logger = { info: record, warn: record, error: record, logError: () => undefined };
  return {
    state: createOAuthStateStore<{ verifier: string }>({ pool: web, sealer, log }),
    session: createOAuthSessionStore<Saved>({ pool: web, sealer, log }),
    logged,
    log,
  };
}

const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(web, null, async (client) => (await client.query<T>(text, values)).rows);

describe("oauth stores", () => {
  test("stores_sealed_at_rest", async () => {
    const { state, session } = setup();
    const verifier = "pkce-verifier-that-must-never-be-stored-in-clear";
    await state.set("state-1", { verifier });
    await session.set(DID_A, { authMethod: { method: "private_key_jwt", kid: "A" }, tokenSet: { a: verifier } });
    const [stateRow] = await sql<{ sealed: string }>("SELECT sealed FROM app.oauth_state WHERE key = 'state-1'");
    const [sessionRow] = await sql<{ sealed: string }>("SELECT sealed FROM app.oauth_session WHERE did = $1", [DID_A]);
    expect(stateRow?.sealed).not.toContain(verifier);
    expect(sessionRow?.sealed).not.toContain(verifier);
    expect(await state.get("state-1")).toEqual({ verifier });
    expect((await session.get(DID_A))?.tokenSet).toEqual({ a: verifier });
  });

  test("stores_aad_binding", async () => {
    const { session, logged } = setup();
    await session.set(DID_A, { authMethod: { method: "private_key_jwt", kid: "A" }, tokenSet: { a: "a" } });
    await session.set(DID_B, { authMethod: { method: "private_key_jwt", kid: "A" }, tokenSet: { a: "b" } });
    // A dump edited to give B's token set to A, and A's to B: each value is bound to its own DID, so neither opens.
    await sql(
      "UPDATE app.oauth_session s SET sealed = o.sealed FROM app.oauth_session o " +
        "WHERE (s.did = $1 AND o.did = $2) OR (s.did = $2 AND o.did = $1)",
      [DID_A, DID_B],
    );
    expect(await session.get(DID_A)).toBeUndefined();
    expect(await session.get(DID_B)).toBeUndefined();
    expect(await sql("SELECT did FROM app.oauth_session WHERE did = ANY($1)", [[DID_A, DID_B]])).toEqual([]);
    expect(logged.filter((line) => line.event === "oauth.unseal_failed")).toEqual([
      { event: "oauth.unseal_failed", fields: { kind: "session" } },
      { event: "oauth.unseal_failed", fields: { kind: "session" } },
    ]);
  });

  test("stores_expiry", async () => {
    const { state } = setup();
    await state.set("state-old", { verifier: "v" });
    await sql("UPDATE app.oauth_state SET expires_at = now() - interval '1 second' WHERE key = 'state-old'");
    expect(await state.get("state-old")).toBeUndefined();
    await state.set("state-new", { verifier: "v" });
    const [row] = await sql<{ left: number }>(
      "SELECT extract(epoch FROM expires_at - now())::int AS left FROM app.oauth_state WHERE key = 'state-new'",
    );
    expect(row?.left).toBeGreaterThan(590);
    expect(row?.left).toBeLessThanOrEqual(600);
    // An abandoned login never reaches del; the hourly sweep removes it and keeps the live one.
    expect(await state.sweep()).toBe(1);
    expect(await sql("SELECT key FROM app.oauth_state WHERE key IN ('state-old', 'state-new')")).toEqual([
      { key: "state-new" },
    ]);
  });

  test("stores_unseal_cleanup_spares_a_newer_value", async () => {
    // Review on #921: between this replica's read of a value that does not open and its cleanup, another replica
    // stores a fresh token set for the same DID. The cleanup deletes only the ciphertext it read.
    const { session } = setup();
    await session.set(DID_B, { authMethod: { method: "private_key_jwt", kid: "A" }, tokenSet: { a: "b" } });
    await session.set(DID_A, { authMethod: { method: "private_key_jwt", kid: "A" }, tokenSet: { a: "a" } });
    await sql(
      "UPDATE app.oauth_session SET sealed = (SELECT sealed FROM app.oauth_session WHERE did = $2) WHERE did = $1",
      [DID_A, DID_B],
    );
    const fresh: Saved = { authMethod: { method: "private_key_jwt", kid: "B" }, tokenSet: { a: "fresh" } };
    const racing = createPool({ connection, service: "oauth-stores-race", max: 1, connectTimeoutMs: 5000 });
    let raced = false;
    const connect = racing.connect.bind(racing);
    racing.connect = (async () => {
      const client = await connect();
      const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<unknown>;
      (client as { query: unknown }).query = async (text: string, values?: unknown[]) => {
        if (!raced && text.startsWith("DELETE")) {
          raced = true;
          await session.set(DID_A, fresh);
        }
        return query(text, values);
      };
      return client;
    }) as typeof racing.connect;
    try {
      const slow = createOAuthSessionStore<Saved>({ pool: racing, sealer, log: setup().log });
      expect(await slow.get(DID_A)).toBeUndefined();
      expect(raced).toBe(true);
      expect((await session.get(DID_A))?.tokenSet).toEqual({ a: "fresh" });
    } finally {
      await racing.end();
    }
  });

  test("stores_client_kid_recorded", async () => {
    const { session } = setup();
    await session.set(DID_A, { authMethod: { method: "private_key_jwt", kid: "A" }, tokenSet: { a: "1" } });
    await session.set(DID_A, { authMethod: { method: "private_key_jwt", kid: "B" }, tokenSet: { a: "2" } });
    expect(await sql("SELECT client_kid FROM app.oauth_session WHERE did = $1", [DID_A])).toEqual([
      { client_kid: "B" },
    ]);
    expect((await session.get(DID_A))?.tokenSet).toEqual({ a: "2" });
  });

  test("stores_del", async () => {
    const { state, session } = setup();
    await state.set("state-del", { verifier: "v" });
    await session.set(DID_B, { authMethod: { method: "private_key_jwt", kid: "A" }, tokenSet: { a: "x" } });
    await state.del("state-del");
    await session.del(DID_B);
    expect(await state.get("state-del")).toBeUndefined();
    expect(await session.get(DID_B)).toBeUndefined();
  });
});
