// P1.34u: the local stack's PLC gets its own role and database from this local-only init file, run after the shared
// bootstrap as compose.local.yaml will run it (P1.34v). Dev and prod never mount this folder, and the role roster
// (roles.json) has no PLC role, so their clusters have neither.
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  randomPassword,
  runUntilExit,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgres,
} from "../../../tests/support/postgres.ts";

const SHARED_INIT = join(import.meta.dirname, "..", "init", "00-bootstrap.sh");
const LOCAL_INIT = join(import.meta.dirname, "10-local-plc.sh");
const ROLES = join(import.meta.dirname, "..", "..", "..", "infrastructure", "postgres", "roles.json");

/** One initdb folder holding the shared bootstrap and the local PLC file, in the order initdb runs them. */
const initDir = mkdtempSync(join(tmpdir(), "unset-init-local-"));
chmodSync(initDir, 0o755);
for (const [source, file] of [
  [SHARED_INIT, "00-bootstrap.sh"],
  [LOCAL_INIT, "10-local-plc.sh"],
] as const) {
  copyFileSync(source, join(initDir, file));
  chmodSync(join(initDir, file), 0o755);
}

const baseSecrets = () => ({ pg_migrator_password: randomPassword(), pg_tap_password: randomPassword() });

afterAll(() => {
  stopAllPostgres();
  rmSync(initDir, { recursive: true, force: true });
}, STOP_ALL_MS);

describe("10-local-plc.sh", () => {
  test("local_plc_init_fails_closed", { timeout: 120_000 }, () => {
    const missing = runUntilExit({ initDir, secrets: baseSecrets() });
    expect(missing.code).not.toBeNull();
    expect(missing.code).not.toBe(0);
    expect(missing.logs).toContain("10-local-plc: secret pg_plc_password is missing or empty");

    const empty = runUntilExit({ initDir, secrets: { ...baseSecrets(), pg_plc_password: "" } });
    expect(empty.code).not.toBeNull();
    expect(empty.code).not.toBe(0);
  });

  test("local_plc_init_creates_role_and_database", { timeout: 120_000 }, async () => {
    const plcPassword = `${randomPassword()} with spaces`;
    const pg = await startPostgres({ initDir, secrets: { ...baseSecrets(), pg_plc_password: `${plcPassword}\n` } });

    // The role: login with a SCRAM verifier and no other attribute.
    const attributes = "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit";
    expect(pg.sql("plc", `${attributes} FROM pg_roles WHERE rolname = 'plc'`)).toBe("f|f|f|f|f|t");
    expect(pg.sql("plc", "SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolname = 'plc'")).toBe("t");
    expect(pg.sql("plc", "SELECT count(*) FROM pg_auth_members WHERE member = 'plc'::regrole")).toBe("0");

    // The database: owned by plc, nothing for PUBLIC, and no right for plc on the app's or tap's database.
    expect(pg.sql("plc", "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'plc'")).toBe("plc");
    const publicRights = ["CONNECT", "CREATE", "TEMPORARY"].map(
      (p) => `has_database_privilege('public', 'plc', '${p}')`,
    );
    expect(pg.sql("plc", `SELECT ${publicRights.join(", ")}`)).toBe("f|f|f");
    expect(
      pg.sql(
        "plc",
        "SELECT has_schema_privilege('public', 'public', 'USAGE'), has_schema_privilege('public', 'public', 'CREATE')",
      ),
    ).toBe("f|f");
    // Every other database a role can connect to, the defaults postgres and template1 included: plc holds neither
    // CONNECT nor TEMPORARY on any of them (PUBLIC holds both on new databases by default, PG 18 ddl-priv).
    expect(
      pg.sql(
        "plc",
        "SELECT datname FROM pg_database WHERE datallowconn AND datname <> 'plc' AND " +
          "(has_database_privilege('plc', datname, 'CONNECT') OR has_database_privilege('plc', datname, 'TEMPORARY')) " +
          "ORDER BY 1",
      ),
    ).toBe("");
    expect(pg.sql("plc", "SELECT count(*) FROM pg_database WHERE datallowconn AND datname <> 'plc'")).toBe("4");

    // The password is the file's contents (trailing newline dropped), over TCP with SCRAM; as owner of its own
    // database plc can run the PLC server's migrations, which create tables in schema public.
    expect(pg.login("plc", "plc", plcPassword, "SELECT current_user")).toBe("plc");
    expect(pg.login("plc", "plc", plcPassword, "CREATE TABLE probe (id int); DROP TABLE probe; SELECT 'ok'")).toBe(
      "CREATE TABLE\nDROP TABLE\nok",
    );
    for (const db of ["unset", "tap", "postgres", "template1"]) {
      expect(() => pg.login("plc", db, plcPassword, "SELECT 1")).toThrow();
    }
  });

  test("local_plc_role_not_in_roster", () => {
    const roles = JSON.parse(readFileSync(ROLES, "utf8")) as { name: string; passwordFrom?: string }[];
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.filter((role) => role.name === "plc" || role.passwordFrom === "pg_plc_password")).toEqual([]);
  });
});
