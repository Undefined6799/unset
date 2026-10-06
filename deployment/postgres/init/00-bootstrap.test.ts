// P1.11g: the bootstrap script in the real Postgres image, run through the one test helper. It fails closed without
// its secrets, and leaves a cluster with exactly migrator, tap, their databases and no PUBLIC rights.
import { afterAll, describe, expect, test } from "vitest";
import { randomPassword, runUntilExit, startPostgres, stopAllPostgres } from "../../../tests/support/postgres.ts";

const initDir = import.meta.dirname;

afterAll(stopAllPostgres);

describe("00-bootstrap.sh", () => {
  test("bootstrap_script_fails_closed", { timeout: 120_000 }, () => {
    const missing = runUntilExit({ initDir, secrets: { pg_tap_password: randomPassword() } });
    expect(missing.code).not.toBeNull();
    expect(missing.code).not.toBe(0);
    expect(missing.logs).toContain("00-bootstrap: secret pg_migrator_password is missing or empty");

    const empty = runUntilExit({ initDir, secrets: { pg_migrator_password: "", pg_tap_password: randomPassword() } });
    expect(empty.code).not.toBeNull();
    expect(empty.code).not.toBe(0);
  });

  test("bootstrap_revokes_public", { timeout: 120_000 }, async () => {
    const migratorPassword = randomPassword();
    const tapPassword = `${randomPassword()} with spaces`;
    const pg = await startPostgres({
      initDir,
      secrets: { pg_migrator_password: `${migratorPassword}\n`, pg_tap_password: tapPassword },
    });

    // PUBLIC has no privilege on either database or on schema public in unset.
    const dbRights = ["CONNECT", "CREATE", "TEMPORARY"].flatMap((p) =>
      ["unset", "tap"].map((db) => `has_database_privilege('public', '${db}', '${p}')`),
    );
    expect(pg.sql("unset", `SELECT ${dbRights.join(", ")}`)).toBe(dbRights.map(() => "f").join("|"));
    expect(
      pg.sql(
        "unset",
        "SELECT has_schema_privilege('public', 'public', 'USAGE'), has_schema_privilege('public', 'public', 'CREATE')",
      ),
    ).toBe("f|f");

    // The only login roles: migrator, tap and the bootstrap superuser, each with a SCRAM verifier.
    expect(
      pg.sql("unset", "SELECT rolname, rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolcanlogin ORDER BY 1"),
    ).toBe("migrator|t\npostgres|t\ntap|t");
    const attributes = "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles";
    expect(pg.sql("unset", `${attributes} WHERE rolname = 'migrator'`)).toBe("f|f|t|f|f");
    expect(pg.sql("unset", `${attributes} WHERE rolname = 'tap'`)).toBe("f|f|f|f|f");
    expect(
      pg.sql(
        "unset",
        "SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname IN ('unset', 'tap') ORDER BY 1",
      ),
    ).toBe("tap|tap\nunset|migrator");
    expect(pg.sql("unset", "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'")).toBe("pgcrypto");
    expect(pg.sql("unset", "SHOW password_encryption")).toBe("scram-sha-256");

    // The passwords are the files' contents (a trailing newline dropped), checked over TCP with SCRAM.
    expect(pg.login("migrator", "unset", migratorPassword, "SELECT current_user")).toBe("migrator");
    expect(pg.login("tap", "tap", tapPassword, "SELECT current_user")).toBe("tap");
  });
});
