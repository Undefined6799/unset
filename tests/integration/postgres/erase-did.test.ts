// P3.07k (migrations 0021 and 0022; 0025 adds the index, 0026 the track queue): core.erase_did against real
// Postgres, connected as real roles (TE-2). The catalog is the list of DID columns (didColumns, P1.13): the test seeds
// every one of them for two people, erases one, and fails while any column still names that person or was never
// seeded, so a new DID table cannot land without its statement in erase_did. The tests run in order on one database
// of its own container.
import { join } from "node:path";
import { verifyChain } from "@unset/infrastructure-audit";
import { didColumns, type Pool, type PoolClient, withClient } from "@unset/infrastructure-postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  migrateAsMigrator,
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgresAfter,
  testPools,
} from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const ROLES = ["web", "admin", "indexer", "retention", "auditor"] as const;
type Role = (typeof ROLES)[number];
const migratorPassword = randomPassword();
const passwords = Object.fromEntries(ROLES.map((role) => [role, randomPassword()])) as Record<Role, string>;
const pools = testPools("erase-did-test");
let postgres: PostgresContainer;
let as: Record<Role, Pool>;
let migrator: Pool;

const X = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const Y = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);

/** One row in every app table that names `did`, written behind the grants: only the DID matters here. */
function seedApp(did: string, fill: string): void {
  const id = `decode(repeat('${fill}', 32), 'hex')`;
  // The token set before the session: a session needs one (session_did_token_set, migration 0024).
  postgres.sql(
    "unset",
    `INSERT INTO app.account (did, first_seen_at, privacy_notice_seen_version) VALUES ('${did}', now(), '2026-11-19');
     INSERT INTO app.oauth_session (did, sealed, client_kid, updated_at) VALUES ('${did}', 's1.k1.made-up', 'kid', now());
     INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at)
       VALUES (${id}, '${did}', now(), now(), now() + interval '1 day');
     INSERT INTO app.single_use (id, purpose, bind_did, expires_at)
       VALUES (${id}, 'login.nonce', '${did}', now() + interval '1 hour');
     INSERT INTO idx.track_request (did, requested_at) VALUES ('${did}', now());
     INSERT INTO app.discoverability (did, search_engines, updated_at) VALUES ('${did}', true, now());
     INSERT INTO app.invite (id, inviter_did, submission_id, state, created_at)
       VALUES (gen_random_uuid(), '${did}', gen_random_uuid(), 'pending', now());
     INSERT INTO app.image (id, did, kind, state, width, height, bytes, created_at)
       VALUES (repeat('${fill}', 16)::uuid, '${did}', 'image', 'published', 1, 1, 1, now());
     INSERT INTO app.image_use (image_id, record_uri)
       VALUES (repeat('${fill}', 16)::uuid, 'at://${did}/sh.unset.section/3kaaaaaaaaaaa');
     INSERT INTO app.image_record (record_uri, did, settled_rev)
       VALUES ('at://${did}/sh.unset.section/3kaaaaaaaaaaa', '${did}', '3kcommit2aaaa');
     INSERT INTO app.image_upload (did, admitted_at) VALUES ('${did}', now());
     INSERT INTO app.notification (did, reason) VALUES ('${did}', 'sign_in');
     INSERT INTO app.sign_in (did) VALUES ('${did}');`,
  );
}

/** One row in every index and moderation table that names `did` (migration 0025). */
function seedIndex(did: string): void {
  const uri = `at://${did}/sh.unset.section/3kaaaaaaaaaaa`;
  postgres.sql(
    "unset",
    `INSERT INTO idx.account (did, updated_at) VALUES ('${did}', now());
     INSERT INTO idx.account_job (did, kind, due_at, first_queued_at) VALUES ('${did}', 'backfill', now(), now());
     INSERT INTO idx.profile (did, uri, cid, rev, record, discoverable, indexed_at)
       VALUES ('${did}', 'at://${did}/sh.unset.profile/self', 'bafyprofile', '3kaaaaaaaaaaa', '{}', true, now());
     INSERT INTO idx.section (uri, did, rkey, cid, rev, record, indexed_at)
       VALUES ('${uri}', '${did}', '3kaaaaaaaaaaa', 'bafysection', '3kaaaaaaaaaaa', '{}', now());
     INSERT INTO idx.record_blob (uri, cid, did, mime, size) VALUES ('${uri}', 'bafyblob', '${did}', 'image/png', 1);
     INSERT INTO idx.dead_letter (kind, did, reason_code, attempts, first_seen, last_seen)
       VALUES ('event', '${did}', 'event_failed', 5, now(), now());
     INSERT INTO mod.account_state (did, delisted, updated_at) VALUES ('${did}', true, now());`,
  );
}

/** Audit rows as their real writers: a security row by and about `did`, and a moderation row about `did`. */
async function seedAudit(did: string, moderator: string): Promise<void> {
  const append = "SELECT audit.append($1, 'succeeded', $2, NULL, $3, $4, NULL, NULL, NULL, NULL)";
  await withClient(as.web, null, (c) => c.query(append, ["age_gate.blocked", did, did, "underage"]));
  await withClient(as.admin, null, (c) => c.query(append, ["mod.takedown", moderator, did, "spam"]));
}

/** Rows naming `did` per DID column, as "schema.table.column" → count; the moderation lane is counted apart. */
async function naming(did: string): Promise<Record<string, number>> {
  // One query for every column, so the count stays one round trip as DID columns are added.
  const counts = (await didColumns(migrator)).map(({ schema, table, column, kind }) => {
    expect(["did", "at_uri"], `${schema}.${table}.${column}: this test counts single DIDs and AT-URIs`).toContain(kind);
    const lane = schema === "audit" ? " AND lane = 'sec'" : "";
    const value = kind === "at_uri" ? `types.at_uri_did("${column}")` : `"${column}"`;
    const key = `${schema}.${table}.${column}`;
    return `SELECT '${key}' || ' ' || count(*) FROM "${schema}"."${table}" WHERE ${value} = '${did}'${lane}`;
  });
  return Object.fromEntries(
    lines(counts.join(" UNION ALL ")).map((line) => {
      const [key, count] = line.split(" ");
      return [key, Number(count)];
    }),
  );
}

async function refused(pool: Pool, fn: (client: PoolClient) => Promise<unknown>, label: string): Promise<string> {
  try {
    await withClient(pool, null, fn);
  } catch (error) {
    let at: unknown = error;
    while (at instanceof Error && (at as { code?: unknown }).code === undefined && at.cause !== undefined)
      at = at.cause;
    return String((at as { code?: unknown }).code);
  }
  return expect.fail(`${label} was not refused`);
}

const erase = (did: string, why: string) =>
  withClient(
    migrator,
    null,
    async (c) => (await c.query("SELECT core.erase_did($1, $2) AS result", [did, why])).rows[0]?.result,
  );

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  for (const role of ROLES) postgres.sql("postgres", `ALTER ROLE ${role} PASSWORD '${passwords[role]}'`);
  as = Object.fromEntries(ROLES.map((role) => [role, pools.open(postgres, "unset", role, passwords[role])])) as Record<
    Role,
    Pool
  >;
  migrator = pools.open(postgres, "unset", "migrator", migratorPassword);
  seedApp(X, "0a");
  seedApp(Y, "0b");
  seedIndex(X);
  seedIndex(Y);
  await seedAudit(X, Y);
  await seedAudit(Y, X);
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("core.erase_did", () => {
  test("every_did_column_is_seeded", async () => {
    // A new DID column fails here until this file seeds it, and then below until erase_did removes it.
    for (const [column, count] of Object.entries(await naming(X))) expect(count, column).toBeGreaterThan(0);
  });

  test("no_service_role_may_erase", async () => {
    for (const role of ROLES) {
      const call = (c: PoolClient) => c.query("SELECT core.erase_did($1, 'user_request')", [X]);
      expect(await refused(as[role], call, role), role).toBe("42501");
      const direct = (c: PoolClient) => c.query("SELECT audit.erase_subject($1)", [X]);
      expect(await refused(as[role], direct, `${role} erase_subject`), role).toBe("42501");
    }
    for (const count of Object.values(await naming(X))) expect(count).toBeGreaterThan(0);
  });

  test("a_reason_outside_the_list_is_refused", async () => {
    await expect(erase(X, "because")).rejects.toMatchObject({ code: "22023" });
    await expect(
      withClient(migrator, null, (c) => c.query("SELECT core.erase_did(NULL, 'user_request')")),
    ).rejects.toMatchObject({ code: "22023" });
  });

  test("an_unknown_did_column_stops_erasure", async () => {
    // A table added without its statement in erase_did: the function refuses instead of reporting a partial erasure.
    const attempt = withClient(migrator, null, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("CREATE TABLE app.erase_probe (who types.did)");
        await c.query("SELECT core.erase_did($1, 'user_request')", [X]);
      } finally {
        await c.query("ROLLBACK");
      }
    });
    await expect(attempt).rejects.toMatchObject({ code: "55000" });
    for (const count of Object.values(await naming(X))) expect(count).toBeGreaterThan(0);
  });

  test("erases_every_row_naming_the_person", async () => {
    const before = await naming(Y);
    const result = await erase(X, "user_request");
    expect(result.outcome).toBe("erased");
    expect(result.counts).toMatchObject({
      "app.account": 1,
      "app.invite": 1,
      "app.session": 1,
      "app.oauth_session": 1,
      "app.single_use": 1,
      "idx.track_request": 1,
      "app.discoverability": 1,
      "app.image": 1,
      "app.image_use": 1,
      "app.image_upload": 1,
      "app.notification": 1,
      "app.image_record": 1,
      "app.sign_in": 1,
      "idx.account": 1,
      "idx.dead_letter": 1,
      "mod.account_state": 1,
    });
    expect(result.counts["audit.event_body"]).toBeGreaterThanOrEqual(1);
    for (const [column, count] of Object.entries(await naming(X))) expect(count, column).toBe(0);
    expect(await naming(Y)).toEqual(before);
  });

  test("the_moderation_lane_keeps_its_rows", () => {
    // Admin design 8: moderation evidence about the person stays until its retention class ends.
    expect(lines(`SELECT count(*) FROM audit.event_body WHERE lane = 'mod' AND subject = '${X}'`)).toEqual(["1"]);
  });

  test("the_erasure_is_recorded_without_the_person", async () => {
    const newest =
      "SELECT c.action || ' ' || c.writer || ' ' || (b.subject IS NULL) || ' ' || (position($$" +
      X +
      "$$ in b.body_text) = 0) " +
      "FROM audit.chain c JOIN audit.event_body b USING (lane, seq) WHERE c.lane = 'sec' ORDER BY c.seq DESC LIMIT 1";
    expect(lines(newest)).toEqual(["account.erased migrator true true"]);
    await expect(withClient(as.auditor, null, (c) => verifyChain(c, "sec", "links"))).resolves.toMatchObject({
      ok: true,
    });
  });

  test("a_second_run_finds_nothing", async () => {
    const result = await erase(X, "user_request");
    expect(result.counts).toEqual({
      "app.account": 0,
      "app.invite": 0,
      "app.session": 0,
      "app.oauth_session": 0,
      "app.single_use": 0,
      "idx.track_request": 0,
      "app.discoverability": 0,
      "app.image": 0,
      "app.image_use": 0,
      "app.image_upload": 0,
      "app.notification": 0,
      "app.image_record": 0,
      "app.sign_in": 0,
      "audit.event_body": 0,
      "idx.account": 0,
      "idx.dead_letter": 0,
      "mod.account_state": 0,
    });
  });

  test("the_tombstone_marks_only_the_erased_person", async () => {
    // P3.07s (migration 0028): idx.is_erased answers for the indexer from a keyed HMAC, never the DID itself.
    const erased = async (did: string) =>
      withClient(as.indexer, null, async (c) => (await c.query("SELECT idx.is_erased($1) AS e", [did])).rows[0]?.e);
    expect(await erased(X)).toBe(true);
    expect(await erased(Y)).toBe(false);
    // One row after two erasures of X, and no column of it holds the DID's text.
    expect(lines("SELECT count(*) || ' ' || bool_and(length(did_hmac) = 32) FROM core.erased_did")).toEqual(["1 true"]);
    expect(lines(`SELECT count(*) FROM core.erased_did t WHERE position('${X}' in t::text) > 0`)).toEqual(["0"]);
  });

  test("only_definers_read_the_tombstone", async () => {
    for (const role of ROLES) {
      for (const table of ["core.erased_did", "core.tombstone_key"]) {
        expect(await refused(as[role], (c) => c.query(`SELECT 1 FROM ${table}`), `${role} ${table}`)).toBe("42501");
      }
      if (role !== "indexer") {
        const call = (c: PoolClient) => c.query("SELECT idx.is_erased($1)", [X]);
        expect(await refused(as[role], call, `${role} is_erased`)).toBe("42501");
      }
      const hmac = (c: PoolClient) => c.query("SELECT core.erased_did_hmac($1)", [X]);
      expect(await refused(as[role], hmac, `${role} erased_did_hmac`)).toBe("42501");
    }
    // Replacing erase_did kept its grants: its owner and nobody else.
    const grantees =
      "SELECT string_agg(a.grantee::regrole::text, ',' ORDER BY 1) FROM pg_catalog.pg_proc p, " +
      "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = 'core.erase_did(types.did, text)'::regprocedure";
    expect(lines(grantees)).toEqual(["migrator"]);
  });

  test("no_key_fails_closed", async () => {
    // A missing key must not read as "nobody was erased": both calls fail and nothing is written. The tombstones are
    // emptied too, so a scan with no rows cannot skip computing the HMAC (EXISTS need not evaluate its WHERE).
    const codes = await withClient(migrator, null, async (c) => {
      const code = async (sql: string, values: unknown[]) => {
        await c.query("SAVEPOINT s");
        try {
          await c.query(sql, values);
          return "ran";
        } catch (error) {
          return String((error as { code?: unknown }).code);
        } finally {
          await c.query("ROLLBACK TO SAVEPOINT s");
        }
      };
      await c.query("BEGIN");
      try {
        await c.query("DELETE FROM core.tombstone_key");
        await c.query("DELETE FROM core.erased_did");
        return [
          await code("SELECT idx.is_erased($1)", [X]),
          await code("SELECT core.erase_did($1, 'user_request')", [Y]),
        ];
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(codes).toEqual(["55000", "55000"]);
    expect(lines("SELECT count(*) FROM core.tombstone_key")).toEqual(["1"]);
  });
});
