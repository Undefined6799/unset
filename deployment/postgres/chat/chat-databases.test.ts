// P6.02 (ADR 0086 Decision 3): the chat servers' roles and databases, made by chat-databases.sh in a cluster the
// shared bootstrap made, as an operator runs it (docs/human/runbooks/chat-servers.md). It fails closed without its
// secrets, can run again without changing anything, and leaves each role owning only its own database.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { docker } from "../../../tests/support/docker.ts";
import {
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgres,
} from "../../../tests/support/postgres.ts";

const initDir = join(import.meta.dirname, "..", "init");
const SCRIPT = readFileSync(join(import.meta.dirname, "chat-databases.sh"), "utf8");
const base = () => ({ pg_migrator_password: randomPassword(), pg_tap_password: randomPassword() });

/** Runs the script inside the container as its postgres user, over the local socket, as the runbook does. */
const runScript = (pg: PostgresContainer) =>
  docker(["exec", "-i", "-u", "postgres", pg.name, "bash", "-s"], { timeoutMs: 60_000, input: SCRIPT });

afterAll(stopAllPostgres, STOP_ALL_MS);

describe("chat-databases.sh", () => {
  test("chat_databases_fail_closed_without_their_secrets", { timeout: 120_000 }, async () => {
    const pg = await startPostgres({ initDir, secrets: { ...base(), pg_synapse_password: randomPassword() } });
    const ran = runScript(pg);
    expect(ran.code).not.toBe(0);
    expect(ran.err).toContain("chat-databases: secret pg_mas_password is missing or empty");
    expect(pg.sql("unset", "SELECT count(*) FROM pg_roles WHERE rolname IN ('synapse', 'mas')")).toBe("0");
  });

  test("chat_databases_are_owned_by_their_roles_only", { timeout: 180_000 }, async () => {
    const synapse = `${randomPassword()} with spaces`;
    const mas = randomPassword();
    const pg = await startPostgres({
      initDir,
      secrets: { ...base(), pg_synapse_password: `${synapse}\n`, pg_mas_password: mas },
    });
    expect(runScript(pg).code).toBe(0);
    // A second run changes nothing and does not fail: the staging cluster gets it once, by hand.
    expect(runScript(pg).code).toBe(0);

    const attributes =
      "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles";
    expect(pg.sql("unset", `${attributes} WHERE rolname IN ('synapse', 'mas') ORDER BY 1`)).toBe(
      "mas|f|f|f|f|f\nsynapse|f|f|f|f|f",
    );
    expect(
      pg.sql(
        "unset",
        "SELECT count(*) FROM pg_authid WHERE rolname IN ('synapse', 'mas') AND rolpassword LIKE 'SCRAM-SHA-256$%'",
      ),
    ).toBe("2");
    // Synapse refuses a database whose collation and ctype are not C (synapse docs/postgres.md at v1.165.0).
    expect(
      pg.sql(
        "unset",
        "SELECT datname, pg_get_userbyid(datdba), datcollate, datctype, pg_encoding_to_char(encoding) FROM pg_database " +
          "WHERE datname IN ('synapse', 'mas') ORDER BY 1",
      ),
    ).toMatch(/^mas\|mas\|.*\|.*\|UTF8\nsynapse\|synapse\|C\|C\|UTF8$/);
    for (const db of ["synapse", "mas"]) {
      const rights = ["CONNECT", "CREATE", "TEMPORARY"].map((p) => `has_database_privilege('public', '${db}', '${p}')`);
      expect(pg.sql(db, `SELECT ${rights.join(", ")}`), db).toBe("f|f|f");
    }
    // Neither role reaches the app's database, tap's or the other's.
    for (const [role, others] of [
      ["synapse", ["unset", "tap", "mas"]],
      ["mas", ["unset", "tap", "synapse"]],
    ] as const) {
      const reach = others.map((db) => `has_database_privilege('${role}', '${db}', 'CONNECT')`);
      expect(pg.sql("unset", `SELECT ${reach.join(", ")}`), role).toBe("f|f|f");
    }
    expect(pg.login("synapse", "synapse", synapse, "SELECT current_user")).toBe("synapse");
    expect(pg.login("mas", "mas", mas, "SELECT current_user")).toBe("mas");
  });
});
