// P3.12s (migration 0030): what `web` can read of the index, against real Postgres as the real `web` role (TE-2). The
// index is written as the superuser here, as idx-schema.test.ts writes moderator state: the indexer's own paths have
// their tests. One database of its own container; the tests run in order.
import { join } from "node:path";
import { MAX_PAGE_BYTES } from "@unset/domains-profile";
import {
  createDiscoverabilityStore,
  createPublicProfileStore,
  type Pool,
  type PoolClient,
  withClient,
} from "@unset/infrastructure-postgres";
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
const webPassword = randomPassword();
const migratorPassword = randomPassword();
const pools = testPools("public-profile-test");
let postgres: PostgresContainer;
let web: Pool;
let migrator: Pool;

const SHOWN = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const INACTIVE = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const DELISTED = "did:plc:cccccccccccccccccccccccc";
const SUSPENDED = "did:plc:dddddddddddddddddddddddd";
const NO_PROFILE = "did:plc:eeeeeeeeeeeeeeeeeeeeeeee";
const UNVERIFIED = "did:plc:ffffffffffffffffffffffff";
const HIDDEN = [INACTIVE, DELISTED, SUSPENDED, NO_PROFILE];

const store = () => createPublicProfileStore(web);

/** An account row, its profile unless `profile` is false, and one card. */
function account(did: string, handle: string, opts: { active?: boolean; status?: string; profile?: boolean } = {}) {
  const { active = true, status = "verified", profile = true } = opts;
  const profileRow = `INSERT INTO idx.profile (did, uri, cid, rev, record, display_name, discoverable, indexed_at)
      VALUES ('${did}', 'at://${did}/sh.unset.profile/self', 'cid-p', '3l', '{"displayName":"N"}', 'N', false, now());`;
  postgres.sql(
    "unset",
    `INSERT INTO idx.account (did, handle, handle_status, pds_active, updated_at)
       VALUES ('${did}', '${handle}', '${status}', ${active}, now());
     ${profile ? profileRow : ""}
     INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, indexed_at)
       VALUES ('at://${did}/sh.unset.card/3k', '${did}', '3k', 'cid-s', '3l', '{"type":"x"}', 0, now());`,
  );
}

async function refusedCode(fn: (client: PoolClient) => Promise<unknown>): Promise<string> {
  try {
    await withClient(web, null, fn);
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
  postgres.sql("postgres", `ALTER ROLE web PASSWORD '${webPassword}'`);
  web = pools.open(postgres, "unset", "web", webPassword);
  migrator = pools.open(postgres, "unset", "migrator", migratorPassword);
  account(SHOWN, "alice.unset.test");
  account(INACTIVE, "bob.unset.test", { active: false });
  account(DELISTED, "carol.unset.test");
  account(SUSPENDED, "dan.unset.test");
  account(NO_PROFILE, "erin.unset.test", { profile: false });
  account(UNVERIFIED, "frank.unset.test", { status: "invalid" });
  postgres.sql(
    "unset",
    `INSERT INTO mod.account_state (did, delisted, updated_at) VALUES ('${DELISTED}', true, now());
     INSERT INTO mod.account_state (did, mod_suspended, updated_at) VALUES ('${SUSPENDED}', true, now());`,
  );
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("public profile store", () => {
  test("visible_profile_by_did_and_verified_handle", async () => {
    const byDid = await store().find({ did: SHOWN }, null);
    expect(byDid).toEqual({
      did: SHOWN,
      handle: "alice.unset.test",
      cid: "cid-p",
      record: { displayName: "N" },
      sections: [{ key: "3k", cid: "cid-s", value: { type: "x" } }],
      discoverability: { searchEngines: false, aiSearch: false, title: "", description: "" },
    });
    expect(await store().find({ handle: "alice.unset.test" }, null)).toEqual(byDid);
  });

  test("hidden_accounts_read_as_missing", async () => {
    for (const did of HIDDEN) expect(await store().find({ did }, null)).toBeNull();
    for (const handle of ["bob.unset.test", "carol.unset.test", "dan.unset.test", "erin.unset.test"])
      expect(await store().find({ handle }, null)).toBeNull();
    expect(await store().find({ did: "did:plc:zzzzzzzzzzzzzzzzzzzzzzzz" }, null)).toBeNull();
  });

  test("unverified_handle_is_never_shown_or_matched", async () => {
    expect((await store().find({ did: UNVERIFIED }, null))?.handle).toBeNull();
    expect(await store().find({ handle: "frank.unset.test" }, null)).toBeNull();
  });

  test("web_sees_no_hidden_row_in_the_views", async () => {
    const dids = await withClient(web, null, (c) =>
      c.query<{ did: string }>(
        "SELECT did FROM idx.public_profile UNION SELECT did FROM idx.public_section ORDER BY did",
      ),
    );
    expect(dids.rows.map((r) => r.did)).toEqual([SHOWN, UNVERIFIED]);
  });

  test("web_reads_no_index_table", async () => {
    for (const table of ["idx.account", "idx.profile", "idx.section", "idx.visible_account", "mod.account_state"])
      expect(await refusedCode((c) => c.query(`SELECT 1 FROM ${table} LIMIT 1`))).toBe("42501");
    const writes = await withClient(web, null, (c) =>
      c.query<{ any: boolean }>(
        `SELECT bool_or(has_table_privilege('web', v, 'INSERT, UPDATE, DELETE, TRUNCATE')) AS any
           FROM unnest(ARRAY['idx.public_profile', 'idx.public_section']) v`,
      ),
    );
    expect(writes.rows[0]?.any).toBe(false);
  });

  test("search_and_ai_choices_saved_for_one_member_and_listed_only_when_visible", async () => {
    postgres.sql(
      "unset",
      `INSERT INTO app.account (did, first_seen_at) VALUES ('${SHOWN}', now()), ('${INACTIVE}', now()), ('${UNVERIFIED}', now())`,
    );
    const own = createDiscoverabilityStore(web);
    const choice = { searchEngines: true, aiSearch: true, title: "T", description: "D" };
    await own.save(SHOWN, choice, null);
    await own.save(INACTIVE, choice, null);
    await own.save(UNVERIFIED, { ...choice, aiSearch: false }, null);
    expect(await own.get(SHOWN, null)).toEqual({ choices: choice, page: { handle: "alice.unset.test" } });
    expect((await own.get(INACTIVE, null)).page).toBeNull(); // hidden: the index shows no page
    expect((await store().find({ did: SHOWN }, null))?.discoverability).toEqual(choice);
    expect(await store().listed("searchEngines", 10, null)).toEqual([
      { did: SHOWN, handle: "alice.unset.test" },
      { did: UNVERIFIED, handle: null },
    ]);
    expect(await store().listed("aiSearch", 10, null)).toEqual([{ did: SHOWN, handle: "alice.unset.test" }]);
    expect(await store().listed("searchEngines", 1, null)).toHaveLength(1);
  });

  // ADR 0078: a page shown to fewer than everyone is never listed, whatever its switches say; unknown fails closed.
  test("a_page_that_is_not_public_is_never_listed", async () => {
    const setVisibility = (value: string) =>
      postgres.sql(
        "unset",
        `UPDATE idx.profile SET record = record || '{"visibility":${value}}' WHERE did = '${SHOWN}'`,
      );
    for (const value of ['"signed-in"', '"owner-only"', '"friends"', "null"]) {
      setVisibility(value);
      expect(await store().listed("searchEngines", 10, null), value).toEqual([{ did: UNVERIFIED, handle: null }]);
      expect(await store().listed("aiSearch", 10, null), value).toEqual([]);
    }
    setVisibility('"public"');
    expect(await store().listed("aiSearch", 10, null)).toEqual([{ did: SHOWN, handle: "alice.unset.test" }]);
    postgres.sql("unset", `UPDATE idx.profile SET record = record - 'visibility' WHERE did = '${SHOWN}'`);
  });

  test("all_off_keeps_no_row", async () => {
    const own = createDiscoverabilityStore(web);
    await own.save(UNVERIFIED, { searchEngines: false, aiSearch: false, title: "", description: "" }, null);
    expect(postgres.sql("unset", `SELECT count(*) FROM app.discoverability WHERE did = '${UNVERIFIED}'`).trim()).toBe(
      "0",
    );
    // No row reads as all off; an account the index shows with no verified handle has a page named by its DID.
    expect(await own.get(UNVERIFIED, null)).toEqual({
      choices: { searchEngines: false, aiSearch: false, title: "", description: "" },
      page: { handle: null },
    });
  });

  test("the_table_refuses_overlong_text", async () => {
    const own = createDiscoverabilityStore(web);
    await expect(
      own.save(SHOWN, { searchEngines: true, aiSearch: false, title: "x".repeat(71), description: "" }, null),
    ).rejects.toMatchObject({ code: "23514" });
  });

  // Review of #1911: web reads the cards in page order and stops at MAX_PAGE_BYTES, whatever the index holds.
  test("cards_come_in_page_order_and_stop_at_the_page_budget", async () => {
    const card = (rkey: string, position: number | null, bytes: number) =>
      `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, position, bytes, indexed_at)
         VALUES ('at://${UNVERIFIED}/sh.unset.card/${rkey}', '${UNVERIFIED}', '${rkey}', 'cid-${rkey}', '3l',
                 '{"type":"${rkey}"}', ${position}, ${bytes}, now());`;
    postgres.sql(
      "unset",
      [card("3a", null, 200), card("3n", 1, MAX_PAGE_BYTES - 100), card("3m", null, 5), card("3z", null, 1)].join("\n"),
    );
    // 3k (position 0, its size counted from its jsonb), then 3n; then the unlisted ones by key, but 3a would pass the
    // budget, so neither it nor the smaller ones after it are read.
    const sections = (await store().find({ did: UNVERIFIED }, null))?.sections ?? [];
    expect(sections.map((s) => s.key)).toEqual(["3k", "3n"]);
  });

  test("erased_account_reads_as_missing", async () => {
    await withClient(migrator, null, (c) => c.query("SELECT core.erase_did($1, 'user_request')", [SHOWN]));
    expect(await store().find({ did: SHOWN }, null)).toBeNull();
    expect(await store().find({ handle: "alice.unset.test" }, null)).toBeNull();
  });
});
