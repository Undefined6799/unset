// P2.03t (infrastructure/postgres/migrations/0024_app_session_token_set_fk.sql, ADR 0049): the migration deletes rows
// before it adds its constraint, so what it deletes is tested against data, on the schema as it was before it. A
// database is migrated up to 0023 from a copy of the folder, sessions are seeded with and without a token set, and
// the real folder is then applied: only the sessions whose DID has no token set may go.
//
// It runs on its own container through tests/support/postgres.ts, like sealed-columns.test.ts: the shared template
// is already past 0024, and a session without a token set cannot be written there.
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  migrateAsMigrator,
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgres,
} from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const MIGRATIONS = join(REPOSITORY, "infrastructure", "postgres", "migrations");
const THIS = "0024_app_session_token_set_fk.sql";
const DATABASE = "session_fk";
const migratorPassword = randomPassword();
let postgres: PostgresContainer;
let before: string;

const KEPT = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const ORPHAN = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER_ORPHAN = "did:plc:cccccccccccccccccccccccc";

const lines = (query: string) => postgres.sql(DATABASE, query).split("\n").filter(Boolean);
const constraints = () =>
  lines("SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid = 'app.session'::regclass AND contype = 'f'");

/** One session row for `did`; `fill` is two hex digits, repeated into its 32-byte id hash. */
const session = (did: string, fill: string) =>
  `INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at)
     VALUES (decode(repeat('${fill}', 32), 'hex'), '${did}', now(), now(), now() + interval '1 day');`;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  postgres.sql("postgres", `CREATE DATABASE ${DATABASE} OWNER migrator`);
  postgres.sql(DATABASE, `REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC`);
  // The folder as it was before this migration: every file that sorts before it.
  before = mkdtempSync(join(tmpdir(), "unset-migrations-"));
  for (const file of readdirSync(MIGRATIONS)) {
    if (file < THIS) copyFileSync(join(MIGRATIONS, file), join(before, file));
  }
}, 120_000);
afterAll(() => {
  rmSync(before, { recursive: true, force: true });
  stopAllPostgres();
}, STOP_ALL_MS);

describe("migration 0024", () => {
  test("session_fk.cleanup_deletes_only_sessions_without_a_token_set", async () => {
    expect(readdirSync(MIGRATIONS)).toContain(THIS);
    await migrateAsMigrator(postgres, migratorPassword, DATABASE, before);
    expect(constraints()).toEqual([]);

    postgres.sql(
      DATABASE,
      `INSERT INTO app.oauth_session (did, sealed, client_kid, updated_at) VALUES ('${KEPT}', 's1.k1.made-up', 'kid', now());
       ${session(KEPT, "0a")}
       ${session(KEPT, "0b")}
       ${session(ORPHAN, "0c")}
       ${session(ORPHAN, "0d")}
       ${session(OTHER_ORPHAN, "0e")}`,
    );
    expect(lines("SELECT count(*) FROM app.session")).toEqual(["5"]);

    await migrateAsMigrator(postgres, migratorPassword, DATABASE);

    // The two sessions of the DID with a token set, and nothing else. Its token set is untouched.
    expect(
      lines("SELECT did || ' ' || encode(substring(id_hash FROM 1 FOR 1), 'hex') FROM app.session ORDER BY 1"),
    ).toEqual([`${KEPT} 0a`, `${KEPT} 0b`]);
    expect(lines("SELECT did FROM app.oauth_session")).toEqual([KEPT]);
    expect(constraints()).toEqual(["session_did_token_set"]);
  });
});
