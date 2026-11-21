// P3.12v (infrastructure/postgres/migrations/0040_idx_section_bytes.sql): a card indexed before the migration is given
// the size the save and the indexer count (domains/profile `recordBytes`: its JSON in UTF-8), not the size of the
// jsonb's text, which adds a space after every colon and comma and would push a page near the budget over it (Codex
// review of #1911). A database is migrated up to 0039 from a copy of the folder, cards are seeded, and the real folder
// is then applied. Its own container, like track-queue-migration.test.ts: the shared template is already past 0040.
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
const THIS = "0040_idx_section_bytes.sql";
const DATABASE = "section_bytes";
const migratorPassword = randomPassword();
let postgres: PostgresContainer;
let before: string;

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
// Nested objects and arrays, empty ones, and strings holding the separators, quotes, escapes and multi-byte text.
const RECORDS = [
  { $type: "sh.unset.section", width: "half", content: { text: 'a, b: c "q" é 😀 \n\t\u0001' } },
  { $type: "sh.unset.section", content: { rows: [{ a: 1, b: [2, [3, {}], []] }, {}], none: null, on: true } },
  {},
];

const sql = (text: string) => text.replaceAll("'", "''");

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

describe("migration 0040", () => {
  test("section_bytes.backfill_counts_each_card_as_the_save_does", async () => {
    expect(readdirSync(MIGRATIONS)).toContain(THIS);
    await migrateAsMigrator(postgres, migratorPassword, DATABASE, before);
    const cards = RECORDS.map(
      (record, n) =>
        `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, indexed_at) VALUES ('at://${DID}/sh.unset.section/k${n}', '${DID}', 'k${n}', 'c', 'r', '${sql(JSON.stringify(record))}', now());`,
    );
    postgres.sql(DATABASE, `INSERT INTO idx.account (did, updated_at) VALUES ('${DID}', now());${cards.join("")}`);

    await migrateAsMigrator(postgres, migratorPassword, DATABASE);

    const stored = postgres.sql(DATABASE, "SELECT bytes FROM idx.section ORDER BY rkey").split("\n").filter(Boolean);
    expect(stored.map(Number)).toEqual(RECORDS.map((record) => Buffer.byteLength(JSON.stringify(record), "utf8")));
  });
});
