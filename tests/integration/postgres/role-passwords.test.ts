// P1.12p follow-up: role password sync against real Postgres (infrastructure/postgres/roles.ts through its index). It runs
// on its own container through tests/support/postgres.ts, like grants.test.ts: role passwords are cluster-global, so
// setting web's here must never reach the shared integration cluster other test files log in to.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createPool,
  migrate,
  type PasswordSyncResult,
  syncRolePasswords,
  withClient,
} from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const migratorPassword = randomPassword();
const secretsDir = mkdtempSync(join(tmpdir(), "unset-role-passwords-"));
/** Every password this file sets, to look for in the server log at the end. */
const used: string[] = [];
const results: PasswordSyncResult[] = [];
let postgres: PostgresContainer;

function connection(user: string, password: string) {
  return { host: "127.0.0.1", port: postgres.port, database: "unset", user, password, ssl: false };
}

/** Writes a fresh password for each role and returns them by role. */
function newPasswords(...roles: string[]): Record<string, string> {
  const passwords: Record<string, string> = {};
  for (const role of roles) {
    passwords[role] = randomPassword();
    used.push(passwords[role]);
    writeFileSync(join(secretsDir, `pg_${role}_password`), `${passwords[role]}\n`);
  }
  return passwords;
}

async function sync(roster?: { name: string; passwordFrom: string | null }[]): Promise<PasswordSyncResult> {
  const options = { connection: connection("migrator", migratorPassword), secretsDir };
  const result = await syncRolePasswords(roster ? { ...options, roster } : options);
  results.push(result);
  return result;
}

/** Logs in from the host, where the image's pg_hba asks for a SCRAM password (inside the container 127.0.0.1 is
 * trusted). Resolves to the SQLSTATE of a refused login, or "ok". */
async function login(user: string, password: string): Promise<string> {
  const pool = createPool({
    connection: connection(user, password),
    service: "role-passwords-test",
    max: 1,
    connectTimeoutMs: 5000,
    statementTimeoutMs: 5000,
    idleInTransactionTimeoutMs: 5000,
  });
  try {
    await withClient(pool, null, (client) => client.query("SELECT 1"));
    return "ok";
  } catch (error) {
    return String((error as { cause?: { code?: unknown } }).cause?.code);
  } finally {
    await pool.close();
  }
}

describe("role passwords on postgres", () => {
  beforeAll(async () => {
    postgres = await startPostgres({
      initDir: join(REPOSITORY, "deployment", "postgres", "init"),
      secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
    });
    const migrated = await migrate({
      connection: connection("migrator", migratorPassword),
      dir: join(REPOSITORY, "infrastructure", "postgres", "migrations"),
      root: REPOSITORY,
      log: createLogger({ service: "migrate", commit: "0".repeat(40), env: "test", write: () => undefined }),
      retryDelaysMs: [],
    });
    if (!migrated.ok) throw new Error(`migration failed: ${migrated.reason}`);
  }, 120_000);
  afterAll(() => {
    stopAllPostgres();
    rmSync(secretsDir, { recursive: true, force: true });
  });

  test("password_sync", async () => {
    const first = newPasswords("web", "api", "indexer");
    expect(await sync()).toEqual({ ok: true, roles: ["web", "api", "indexer"] });
    for (const role of ["web", "api", "indexer"]) expect(await login(role, first[role] ?? "")).toBe("ok");
    // Stored as the client-side verifier, never as text the server hashed.
    expect(
      postgres.sql("postgres", "SELECT rolpassword LIKE 'SCRAM-SHA-256$4096:%' FROM pg_authid WHERE rolname = 'web'"),
    ).toBe("t");

    // Rotation: change the file and run it again; the old password stops working.
    const second = newPasswords("web");
    expect(await sync()).toMatchObject({ ok: true });
    expect(await login("web", second.web ?? "")).toBe("ok");
    expect(await login("web", first.web ?? "")).toBe("28P01");
  });

  test("password_sync_missing_file", async () => {
    const before = newPasswords("web", "api", "indexer");
    expect(await sync()).toMatchObject({ ok: true });
    newPasswords("web");
    rmSync(join(secretsDir, "pg_api_password"));
    expect(await sync()).toEqual({ ok: false, reason: "secret_unreadable", role: "api" });
    // No role altered: web still takes the password from before the failed run.
    expect(await login("web", before.web ?? "")).toBe("ok");
  });

  test("role_absent_alters_nothing", async () => {
    const before = newPasswords("web");
    expect(await sync([{ name: "web", passwordFrom: "pg_web_password" }])).toMatchObject({ ok: true });
    newPasswords("web", "ghost");
    const roster = [
      { name: "web", passwordFrom: "pg_web_password" },
      { name: "ghost", passwordFrom: "pg_ghost_password" },
    ];
    expect(await sync(roster)).toEqual({ ok: false, reason: "role_absent", role: "ghost" });
    expect(await login("web", before.web ?? "")).toBe("ok");
  });

  test("password_never_logged", () => {
    const logs = spawnSync("docker", ["logs", postgres.name], { encoding: "utf8" });
    const text = `${logs.stdout}${logs.stderr}${JSON.stringify(results)}`;
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((password) => text.includes(password))).toEqual([]);
  });
});
