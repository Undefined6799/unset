// P3.03s (migration 0025): the index schema against real Postgres, with the indexer connected as its real role
// (TE-2). Moderator state is written as the superuser until book P3.06 adds the `mod` functions, as the book's
// idx-rebuild-preserves-decisions test allows. The tests run in order on one database of their own container.
import { join } from "node:path";
import { type Pool, type PoolClient, withClient } from "@unset/infrastructure-postgres";
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
const indexerPassword = randomPassword();
const migratorPassword = randomPassword();
const pools = testPools("idx-schema-test");
let postgres: PostgresContainer;
let indexer: Pool;
let migrator: Pool;

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const C = "did:plc:cccccccccccccccccccccccc";
const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);
const visible = () => lines("SELECT did FROM idx.visible_account ORDER BY did");

async function refusedCode(fn: (client: PoolClient) => Promise<unknown>): Promise<string> {
  try {
    await withClient(indexer, null, fn);
  } catch (error) {
    let at: unknown = error;
    while (at instanceof Error && (at as { code?: unknown }).code === undefined && at.cause !== undefined)
      at = at.cause;
    return String((at as { code?: unknown }).code);
  }
  return expect.fail("the statement was not refused");
}

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE indexer PASSWORD '${indexerPassword}'`);
  indexer = pools.open(postgres, "unset", "indexer", indexerPassword);
  migrator = pools.open(postgres, "unset", "migrator", migratorPassword);
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("idx schema", () => {
  test("new_account_row_starts_hidden", async () => {
    await withClient(indexer, null, (c) =>
      c.query("INSERT INTO idx.account (did, track_requested_at, updated_at) VALUES ($1, now(), now())", [A]),
    );
    expect(lines(`SELECT pds_active FROM idx.account WHERE did = '${A}'`)).toEqual(["f"]);
    expect(visible()).toEqual([]);
    await withClient(indexer, null, (c) => c.query("UPDATE idx.account SET pds_active = true WHERE did = $1", [A]));
    expect(visible()).toEqual([A]);
  });

  test("idx_rebuild_preserves_decisions", () => {
    // F-01: a delist or a suspension lives outside the index, so a rebuild cannot clear it.
    postgres.sql(
      "unset",
      `INSERT INTO mod.account_state (did, delisted, updated_at) VALUES ('${A}', true, now());
       INSERT INTO mod.account_state (did, mod_suspended, updated_at) VALUES ('${B}', true, now());
       TRUNCATE idx.account CASCADE;
       INSERT INTO idx.account (did, pds_active, updated_at)
         VALUES ('${A}', true, now()), ('${B}', true, now()), ('${C}', true, now());`,
    );
    expect(visible()).toEqual([C]);
  });

  test("indexer_cannot_touch_moderator_state", async () => {
    expect(await refusedCode((c) => c.query("SELECT did FROM mod.account_state"))).toBe("42501");
    expect(await refusedCode((c) => c.query("UPDATE idx.account SET moderation_version = 9 WHERE did = $1", [A]))).toBe(
      "42501",
    );
    expect(await refusedCode((c) => c.query("SELECT did FROM idx.visible_account"))).toBe("42501");
  });

  test("rev_guard_columns_not_null", () => {
    const revs = lines(
      `SELECT c.relname || ' ' || a.attnotnull || ' ' || coalesce(co.collname, '')
         FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         LEFT JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation
        WHERE c.relnamespace = 'idx'::regnamespace AND c.relkind = 'r' AND a.attname IN ('rev', 'last_rev')
        ORDER BY c.relname`,
    );
    expect(revs).toEqual(["account false C", "page true C", "profile true C", "section true C"]);
  });

  test("rev_collation_bytewise", async () => {
    // TIDs use base32-sortable characters (https://atproto.com/specs/tid); text order must equal byte order.
    const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
    const tids = Array.from({ length: 1000 }, () =>
      Array.from({ length: 13 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""),
    );
    // The column's own collation orders them: 1,000 cards for A, read back in rev order.
    await withClient(indexer, null, (c) =>
      c.query(
        `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, indexed_at)
         SELECT 'at://' || $1 || '/sh.unset.card/' || r, $1, r, 'bafysection', r, '{}', now()
           FROM unnest($2::text[]) WITH ORDINALITY AS u (t, n), LATERAL (SELECT t || n AS r) x`,
        [A, tids],
      ),
    );
    const read = await withClient(
      indexer,
      null,
      async (c) =>
        (await c.query<{ rev: string }>("SELECT rev FROM idx.section WHERE did = $1 ORDER BY rev", [A])).rows,
    );
    const bytewise = tids.map((t, i) => `${t}${i + 1}`).sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
    expect(read.map((r) => r.rev)).toEqual(bytewise);
  });

  test("erased_person_leaves_no_index_row", async () => {
    await withClient(indexer, null, (c) =>
      c.query(
        `INSERT INTO idx.profile (did, uri, cid, rev, record, discoverable, indexed_at)
         VALUES ($1, $2, 'bafyprofile', '3kaaaaaaaaaaa', '{}', true, now())`,
        [C, `at://${C}/sh.unset.profile/self`],
      ),
    );
    // Erasure runs as migrator, its only caller until a step grants it (migration 0022's header).
    await withClient(migrator, null, (c) => c.query("SELECT core.erase_did($1, 'user_request')", [C]));
    expect(lines(`SELECT count(*) FROM idx.account WHERE did = '${C}'`)).toEqual(["0"]);
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${C}'`)).toEqual(["0"]);
  });
});
