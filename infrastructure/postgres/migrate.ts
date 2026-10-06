// The migration runner (P1.11; plan §5.2): SQL files applied once, in order, by the `migrator` role, under an advisory
// lock, with checksums that stop edited history and a "database ahead" rule for rollback deploys. Driver: node-postgres
// 8.23.0 (ADR 0014); multi-statement files run over the simple query protocol (node_modules/pg/lib/client.js query()
// with no values), which Postgres runs as one implicit transaction unless the file is already inside ours.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@unset/shared-log";
import pg from "pg";
import type { Connection } from "./config.ts";
import { type LintProblem, lintMigration, type Phase } from "./sqlLint.ts";
import { inTransaction } from "./tx.ts";

/** The advisory lock key every runner takes: "unse" in ASCII. */
export const MIGRATE_LOCK_ID = 0x756e7365;

export type MigrateOptions = {
  readonly connection: Connection;
  /** The migrations folder. */
  readonly dir: string;
  /** The repository root, against which an index's `-- query:` file is checked. */
  readonly root: string;
  readonly log: Logger;
  /** How long to wait for another runner's lock. Default 60 s. */
  readonly lockWaitMs?: number;
  /** Waits between connection attempts while Postgres starts. Default 1, 2, 4, 8, 16 s (31 s in all). */
  readonly retryDelaysMs?: readonly number[];
};

/** Exit 1 error, 2 an applied file was edited, 3 a gap in the versions. `reason` is a fixed word. */
export type MigrateFailure = {
  readonly ok: false;
  readonly exit: 1 | 2 | 3;
  readonly reason: string;
  readonly version?: number | undefined;
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly sqlstate?: string | undefined;
};
export type MigrateResult =
  | { readonly ok: true; readonly applied: number[]; readonly ahead: number[] }
  | MigrateFailure;

type Migration = { version: number; file: string; sql: string; checksum: string; phase: Phase; noTx: boolean };

const FILE_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
const PHASE_LINE = /^-- phase: (expand|contract)\s*$/;
const NO_TX_LINE = /^-- unset: no-transaction\s*$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const LOCK_POLL_MS = 250;

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version int PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('expand', 'contract')),
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

const failure = (exit: 1 | 2 | 3, reason: string, extra: Partial<MigrateFailure> = {}): MigrateFailure => ({
  ok: false,
  exit,
  reason,
  ...extra,
});

/** Reads, orders, checks and lints the files. Nothing here touches the database. */
export function readMigrations(dir: string, root: string): Migration[] | MigrateFailure {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const stray = files.find((file) => !FILE_NAME.test(file));
  if (stray !== undefined) return failure(1, "bad_file_name");
  const versions = files.map((file) => Number(FILE_NAME.exec(file)?.[1]));
  if (new Set(versions).size !== versions.length) return failure(1, "duplicate_version");
  if (versions.some((version, i) => version !== i + 1)) return failure(3, "gap");

  const migrations: Migration[] = [];
  for (const [i, file] of files.entries()) {
    const read = readMigration(join(dir, file), versions[i] as number, file, root);
    if ("ok" in read) return read;
    migrations.push(read);
  }
  return migrations;
}

function readMigration(path: string, version: number, file: string, root: string): Migration | MigrateFailure {
  const sql = readFileSync(path, "utf8");
  const [first = "", second = ""] = sql.split("\n");
  const phase = PHASE_LINE.exec(first)?.[1] as Phase | undefined;
  if (phase === undefined) return failure(1, "no_phase_header", { version, file, line: 1 });
  const problem: LintProblem | undefined = lintMigration(sql, phase, root)[0];
  if (problem !== undefined) return failure(1, `lint_${problem.rule}`, { version, file, line: problem.line });
  const checksum = createHash("sha256").update(sql).digest("hex");
  return { version, file, sql, checksum, phase, noTx: NO_TX_LINE.test(second) };
}

/** Applies every pending migration, or explains why not. It logs the outcome; it never throws for an expected one. */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const migrations = readMigrations(options.dir, options.root);
  if (!Array.isArray(migrations)) return report(options.log, migrations);
  const client = await connect(options.connection, options.retryDelaysMs ?? [1000, 2000, 4000, 8000, 16000]);
  if (client === null) return report(options.log, failure(1, "connect_failed"));
  try {
    return report(options.log, await migrateAsMigrator(client, migrations, options.lockWaitMs ?? 60_000));
  } finally {
    // Ending the session also releases the advisory lock if a query above threw before the explicit unlock.
    await client.end();
  }
}

async function migrateAsMigrator(client: pg.Client, migrations: Migration[], lockWaitMs: number) {
  const who = await client.query<{ ok: boolean }>("SELECT current_user = 'migrator' AS ok");
  if (who.rows[0]?.ok !== true) return failure(1, "not_migrator");
  if (!(await lock(client, lockWaitMs))) return failure(1, "lock_timeout");
  const result = await migrateLocked(client, migrations);
  await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_ID]);
  return result;
}

async function migrateLocked(client: pg.Client, migrations: Migration[]): Promise<MigrateResult> {
  await client.query(CREATE_TABLE);
  const { rows } = await client.query<{ version: number; checksum: string }>(
    "SELECT version, checksum FROM public.schema_migrations ORDER BY version",
  );
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  const edited = rows.find((row) => (byVersion.get(row.version)?.checksum ?? row.checksum) !== row.checksum);
  if (edited !== undefined) {
    return failure(2, "checksum_mismatch", { version: edited.version, file: byVersion.get(edited.version)?.file });
  }
  // The database is newer than this code (a rollback deploy): the old code runs against the expand-compatible schema.
  const ahead = rows.filter((row) => !byVersion.has(row.version)).map((row) => row.version);
  if (ahead.length > 0) return { ok: true, applied: [], ahead };

  const done = new Set(rows.map((row) => row.version));
  const applied: number[] = [];
  for (const migration of migrations.filter((m) => !done.has(m.version))) {
    const failed = await apply(client, migration);
    if (failed !== null) return failed;
    applied.push(migration.version);
  }
  return { ok: true, applied, ahead: [] };
}

async function apply(client: pg.Client, m: Migration): Promise<MigrateFailure | null> {
  const run = async (): Promise<void> => {
    await client.query(m.sql);
    await client.query(
      "INSERT INTO public.schema_migrations (version, name, checksum, phase) VALUES ($1, $2, $3, $4)",
      [m.version, m.file, m.checksum, m.phase],
    );
  };
  try {
    await (m.noTx ? run() : inTransaction(client, run));
    return null;
  } catch (error) {
    // A no-transaction file may have left part of its work; it must be idempotent so the next run can retry it.
    const reason = m.noTx ? "sql_error_partial" : "sql_error";
    return failure(1, reason, { version: m.version, file: m.file, sqlstate: sqlstateOf(error) });
  }
}

/** The Postgres SQLSTATE of a driver error, never its message (which can quote row values). */
function sqlstateOf(error: unknown): string | undefined {
  const first = error instanceof AggregateError ? error.errors[0] : error;
  const code = (first as { code?: unknown } | null)?.code;
  return typeof code === "string" && SQLSTATE.test(code) ? code : undefined;
}

/** Waits for the session-level advisory lock, polling, so a second runner gives up cleanly after `waitMs`. */
async function lock(client: pg.Client, waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [
      MIGRATE_LOCK_ID,
    ]);
    if (rows[0]?.locked === true) return true;
    if (Date.now() + LOCK_POLL_MS > until) return false;
    await sleep(LOCK_POLL_MS);
  }
}

/** Connects, retrying while Postgres is unreachable or still starting; a refusal from a running server is final. */
async function connect(connection: Connection, delaysMs: readonly number[]): Promise<pg.Client | null> {
  for (let attempt = 0; ; attempt += 1) {
    const client = new pg.Client({ ...connection, application_name: "migrate", connectionTimeoutMillis: 5000 });
    // A dropped connection fails the query in flight; without a listener the 'error' event would end the process.
    client.on("error", () => undefined);
    try {
      await client.connect();
      await client.query("SET lock_timeout = '5s'");
      await client.query("SET statement_timeout = '15min'");
      return client;
    } catch (error) {
      await client.end().catch(() => undefined); // the connection never opened; there is nothing left to close
      const code = sqlstateOf(error);
      const retryable = code === undefined || code === "57P03"; // 57P03: the database system is starting up
      const delay = delaysMs[attempt];
      if (!retryable || delay === undefined) return null;
      await sleep(delay);
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function report(log: Logger, result: MigrateResult): MigrateResult {
  if (!result.ok) {
    const { reason, version, sqlstate } = result;
    log.error("migrate.failed", {
      reason,
      ...(version === undefined ? {} : { version }),
      ...(sqlstate ? { sqlstate } : {}),
    });
  } else if (result.ahead.length > 0) {
    log.warn("migrate.database_ahead", { count: result.ahead.length, version: Math.max(...result.ahead) });
  } else {
    log.info("migrate.done", { count: result.applied.length });
  }
  return result;
}
