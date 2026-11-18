// P3.05s PR 3 (interfaces/indexer/compose.ts): the indexer's composition root against real Postgres as the real
// `indexer` role (TE-2). Off, it opens no connection. On, it checks the pool fits the role's connection limit before
// anything starts, and once the stop signal aborts, `done` resolves only after the pool has ended.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "@unset/shared-config";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compose } from "../../../interfaces/indexer/compose.ts";
import { schema } from "../../../interfaces/indexer/config.ts";
import {
  migrateAsMigrator,
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgresAfter,
} from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const indexerPassword = randomPassword();
const migratorPassword = randomPassword();
const log = createLogger({ service: "indexer", commit: "1".repeat(40), env: "test", write: () => undefined });
let postgres: PostgresContainer;
let passwordFile: string;

const connections = () =>
  postgres.sql("postgres", "SELECT count(*) FROM pg_stat_activity WHERE usename = 'indexer'").trim();

const configWith = (env: Record<string, string>) =>
  loadConfig(
    schema,
    {
      UNSET_ENV: "test",
      UNSET_SERVICE: "indexer",
      UNSET_COMMIT: "1".repeat(40),
      LISTEN_PORT: "8081",
      PG_HOST: "127.0.0.1",
      PG_PORT: String(postgres.port),
      PG_DATABASE: "unset",
      PG_USER: "indexer",
      PG_PASSWORD_FILE: passwordFile,
      PG_SSLMODE: "disable",
      PG_POOL_MAX: "2",
      PLC_URL: "https://plc.directory",
      PDS_PUBLIC_URL: "https://pds.example.test",
      // Nothing listens there: the stream stops and redials, which is all this test needs of it.
      INDEXER_PDS_URL: "http://localhost:1",
      INDEXER_ENABLED: "true",
      ...env,
    },
    { onUnknownKeys: () => undefined },
  );

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE indexer PASSWORD '${indexerPassword}'`);
  passwordFile = join(mkdtempSync(join(tmpdir(), "indexer-compose-")), "pg-password");
  writeFileSync(passwordFile, indexerPassword);
}, 120_000);
afterAll(() => stopAllPostgresAfter(async () => undefined), STOP_ALL_MS);

describe("indexer composition root", () => {
  test("indexer.disabled_opens_no_pool", async () => {
    const stop = new AbortController();
    const indexer = await compose(configWith({ INDEXER_ENABLED: "false" }), log, stop.signal);
    expect(await indexer.health()).toEqual({ healthy: true, enabled: false });
    expect(connections()).toBe("0");
    stop.abort();
    await indexer.done;
  });

  test("indexer.a_pool_the_role_cannot_hold_is_refused_and_ended", async () => {
    // The role's limit is 10 (migration 0003); across PG_MAX_REPLICAS=3 each replica may hold 3.
    const refused = compose(configWith({ PG_POOL_MAX: "4" }), log, new AbortController().signal);
    await expect(refused).rejects.toBeInstanceOf(ConfigError);
    expect(connections()).toBe("0");
  });

  test("indexer.stop_ends_the_loop_then_the_pool", async () => {
    const stop = new AbortController();
    const indexer = await compose(configWith({ PG_POOL_MAX: "3" }), log, stop.signal);
    const health = await indexer.health();
    expect(health).toMatchObject({ healthy: true, enabled: true });
    expect(Number(connections())).toBeGreaterThan(0);
    stop.abort();
    await indexer.done;
    expect(connections()).toBe("0");
  });
});
