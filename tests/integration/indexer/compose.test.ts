// P3.05s PR 3 (interfaces/indexer/compose.ts and main.ts): the indexer's composition root and process against real
// Postgres as the real `indexer` role (TE-2). Off, it opens no connection. On, it checks the pool fits the role's
// connection limit before anything starts (exit 78), and once the stop signal aborts, `done` resolves only after the
// pool has ended. The process logs it started only once its health port listens, exits 0 on SIGTERM when everything
// stopped in time, and exits 1 after an unhandled rejection.
import { spawn } from "node:child_process";
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

const baseEnv = (): Record<string, string> => ({
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
  // Nothing listens there: the library retries the dial (reader.ts onRetry), which is all this test needs of it.
  INDEXER_PDS_URL: "http://localhost:1",
  INDEXER_ENABLED: "true",
});
const configWith = (env: Record<string, string>) =>
  loadConfig(schema, { ...baseEnv(), ...env }, { onUnknownKeys: () => undefined });

/** Runs main.ts as its own process with this env; resolves with its exit code and stdout lines. */
function runMain(
  env: Record<string, string>,
  options: { preload?: string; onLine?: (line: string, kill: () => void) => void },
) {
  const args =
    options.preload === undefined ? [] : ["--import", `data:text/javascript,${encodeURIComponent(options.preload)}`];
  const child = spawn(process.execPath, [...args, join(REPOSITORY, "interfaces", "indexer", "main.ts")], {
    env: { PATH: process.env.PATH ?? "", ...baseEnv(), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: string[] = [];
  let buffered = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    const parts = buffered.split("\n");
    buffered = parts.pop() ?? "";
    for (const line of parts) {
      lines.push(line);
      options.onLine?.(line, () => child.kill("SIGTERM"));
    }
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  return exit.finally(() => clearTimeout(timer)).then((code) => ({ code, lines }));
}

const event = (line: string): { event?: string; kind?: string } => {
  try {
    return JSON.parse(line) as { event?: string; kind?: string };
  } catch {
    return {};
  }
};

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

  test("indexer.process_listens_before_it_says_started_and_stops_cleanly", async () => {
    const port = String(20_000 + Math.floor(Math.random() * 20_000));
    let health: { status: number; body: unknown } | null = null;
    const run = await runMain(
      { INDEXER_ENABLED: "false", HEALTH_PORT: port },
      {
        onLine: (line, kill) => {
          if (event(line).event !== "indexer.started") return;
          // Asked the moment the line appears: the port must already listen.
          fetch(`http://127.0.0.1:${port}/health`)
            .then(async (response) => {
              health = { status: response.status, body: await response.json() };
            })
            .finally(kill);
        },
      },
    );
    expect(health).toEqual({ status: 200, body: { healthy: true, enabled: false } });
    expect(run.code).toBe(0);
    expect(run.lines.map(event).find((line) => line.event === "indexer.stopped")?.kind).toBe("finished");
  });

  test("indexer.process_exits_78_on_a_pool_the_role_cannot_hold", async () => {
    expect((await runMain({ PG_POOL_MAX: "4" }, {})).code).toBe(78);
    expect(connections()).toBe("0");
  });

  test("indexer.process_exits_1_after_an_unhandled_rejection", async () => {
    const port = String(20_000 + Math.floor(Math.random() * 20_000));
    const preload = 'setTimeout(() => { Promise.reject(new Error("planted")); }, 500);';
    const run = await runMain({ INDEXER_ENABLED: "false", HEALTH_PORT: port }, { preload });
    expect(run.code).toBe(1);
    expect(run.lines.map(event).find((line) => line.event === "indexer.stopped")?.kind).toBe("finished");
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
