// P1.15m (infrastructure/postgres/migrations/0008_audit.sql): the audit functions against real Postgres. The row hash
// matches a vector computed outside Postgres, and append takes no personal field. P1.15d adds the tables' cases and
// P1.15g the appends.
//
// It runs on its own container through tests/support/postgres.ts, like grants.test.ts: the cases need the owner,
// reached through the superuser's local socket, which the shared cluster does not hand out.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { migrate } from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const vector = readJson<Record<string, string | number>>(join(import.meta.dirname, "audit-row-hash.vector.json"));

const migratorPassword = randomPassword();
let postgres: PostgresContainer;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  const result = await migrate({
    connection: {
      host: "127.0.0.1",
      port: postgres.port,
      database: "unset",
      user: "migrator",
      password: migratorPassword,
      ssl: false,
    },
    dir: join(REPOSITORY, "infrastructure", "postgres", "migrations"),
    root: REPOSITORY,
    log: createLogger({ service: "migrate", commit: "0".repeat(40), env: "test", write: () => undefined }),
    retryDelaysMs: [],
  });
  if (!result.ok) throw new Error(`migration failed: ${result.reason}`);
}, 120_000);
afterAll(() => stopAllPostgres());

/** As the owner, through the superuser's local socket (audit_owner never logs in). */
const asOwner = (text: string) => postgres.sql("unset", `SET ROLE audit_owner; ${text}`).replace(/^SET\n?/, "");

describe("audit lanes", () => {
  test("append_has_no_pii_argument", () => {
    // Alex answered P1a-A1 "No address" (2026-10-07 00:14:42Z): the audit stores no personal field, so append takes none
    // (architecture record 2026-10-06-p115m-tailnet-pii-deferred, "Under B").
    expect(asOwner("SELECT pg_get_function_identity_arguments('audit.append'::regproc)")).toBe(
      "p_action text, p_outcome text, p_actor_did types.did, p_actor_key text, p_target types.did, p_reason text, " +
        "p_case uuid, p_jti text, p_request_id uuid, p_receipt bytea",
    );
  });

  test("row_hash_known_answer", () => {
    const hex = (key: string) => `'\\x${vector[key]}'::bytea`;
    const computed = asOwner(
      `SELECT encode(audit.row_hash('${vector.lane}', ${vector.seq}, '${vector.ts}'::timestamptz, '${vector.action}', ` +
        `'${vector.writer}', '${vector.retentionClass}', ${hex("prevHash")}, ${hex("bodyMac")}), 'hex')`,
    );
    expect(computed).toBe(vector.rowHash);
  });
});
