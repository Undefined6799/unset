// P3.02s (infrastructure/postgres/migrations/0026_track_queue.sql): the migration queues every member who finished
// onboarding before it, and nobody else. A database is migrated up to 0025 from a copy of the folder, accounts are
// seeded at each onboarding step, and the real folder is then applied. Its own container, like
// session-token-set-migration.test.ts: the shared template is already past 0026.
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
const THIS = "0026_track_queue.sql";
const DATABASE = "track_queue";
const migratorPassword = randomPassword();
let postgres: PostgresContainer;
let before: string;

const DONE = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const AT_TERMS = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const BLOCKED = "did:plc:cccccccccccccccccccccccc";
const AT_CHAT = "did:plc:dddddddddddddddddddddddd";

const lines = (query: string) => postgres.sql(DATABASE, query).split("\n").filter(Boolean);
const account = (did: string, onboarding: string) =>
  `INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ('${did}', now(), '${onboarding}');`;

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

describe("migration 0026", () => {
  test("track_queue.backfill_queues_only_finished_members", async () => {
    expect(readdirSync(MIGRATIONS)).toContain(THIS);
    await migrateAsMigrator(postgres, migratorPassword, DATABASE, before);
    postgres.sql(
      DATABASE,
      account(DONE, "done") +
        account(AT_TERMS, "terms") +
        account(BLOCKED, "blocked_underage") +
        account(AT_CHAT, "chat"),
    );

    await migrateAsMigrator(postgres, migratorPassword, DATABASE);

    expect(lines("SELECT did FROM idx.track_request ORDER BY did")).toEqual([DONE]);
  });
});
