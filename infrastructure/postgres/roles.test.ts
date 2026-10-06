// P1.12p (roles.ts): the SCRAM verifier, the one statement sent, and the checks that refuse before any connection. The
// sync against real Postgres, with a login as each role, runs in tests/integration/postgres/role-passwords.test.ts, which
// lands with the index.ts export it imports through (a trusted-base file and its re-export land in two PRs).
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { alterRolePasswordSql, scramVerifier, syncRolePasswords } from "./roles.ts";

/** A fresh password per run, so no credential-shaped literal sits in the repository. */
const PASSWORD = randomBytes(24).toString("base64url");
const dir = mkdtempSync(join(tmpdir(), "unset-roles-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
/** Nothing listens on port 1: a sync that got as far as connecting would report `database`. */
const NOWHERE = { host: "127.0.0.1", port: 1, database: "unset", user: "migrator", password: "x", ssl: false };

describe("role passwords", () => {
  test("scram_verifier_matches_vector", () => {
    // RFC 7677 section 3: user "user", password "pencil". The proof and signature the RFC lists follow from the
    // verifier's StoredKey and ServerKey, so a verifier that matches them is the one PostgreSQL derives at login.
    const salt = "W22ZaJ0SNY7soEsUEjb6gQ==";
    const verifier = scramVerifier("pencil", Buffer.from(salt, "base64"), 4096);
    const match = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verifier);
    expect(match?.[1]).toBe(salt);
    const storedKey = Buffer.from(match?.[2] ?? "", "base64");
    const serverKey = Buffer.from(match?.[3] ?? "", "base64");
    const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const auth = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=${salt},i=4096,c=biws,r=${nonce}`;
    const hmac = (key: Buffer) => createHmac("sha256", key).update(auth).digest();
    const proof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
    const clientKey = Buffer.from(hmac(storedKey).map((byte, i) => byte ^ (proof[i] ?? 0)));
    expect(createHash("sha256").update(clientKey).digest()).toEqual(storedKey);
    expect(hmac(serverKey).toString("base64")).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
  });

  test("verifier_salt_is_random", () => {
    expect(scramVerifier(PASSWORD)).not.toBe(scramVerifier(PASSWORD));
  });

  test("password_never_sent_cleartext", () => {
    const verifier = scramVerifier(PASSWORD);
    const sql = alterRolePasswordSql("web", verifier);
    expect(sql).toBe(`ALTER ROLE "web" PASSWORD '${verifier}'`);
    expect(sql).not.toContain(PASSWORD);
    expect(() => alterRolePasswordSql("web", PASSWORD)).toThrow("refused");
    expect(() => alterRolePasswordSql("web", `${verifier}'; DROP ROLE web; --`)).toThrow("refused");
    expect(() => alterRolePasswordSql('web" SUPERUSER --', verifier)).toThrow("refused");
  });

  test("unknown_role_refused", async () => {
    for (const roster of [
      [{ name: 'web" SUPERUSER --', passwordFrom: "pg_web_password" }],
      [{ name: "Web", passwordFrom: "pg_web_password" }],
      [{ name: "web", passwordFrom: "../../etc/passwd" }],
    ]) {
      const result = await syncRolePasswords({ connection: NOWHERE, secretsDir: dir, roster });
      expect(result).toEqual({ ok: false, reason: "roster_invalid", role: roster[0]?.name });
    }
  });

  test("password_sync_missing_file_refuses_before_connecting", async () => {
    writeFileSync(join(dir, "pg_web_password"), `${PASSWORD}\n`);
    writeFileSync(join(dir, "pg_api_password"), "");
    const roster = [
      { name: "web", passwordFrom: "pg_web_password" },
      { name: "api", passwordFrom: "pg_api_password" },
      { name: "indexer", passwordFrom: "pg_indexer_password" },
    ];
    const result = await syncRolePasswords({ connection: NOWHERE, secretsDir: dir, roster });
    expect(result).toEqual({ ok: false, reason: "secret_unreadable", role: "api" });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  test("password_outside_printable_ascii_refused", async () => {
    writeFileSync(join(dir, "pg_web_password"), "pässwörd-with-umlauts-1234");
    const roster = [{ name: "web", passwordFrom: "pg_web_password" }];
    const result = await syncRolePasswords({ connection: NOWHERE, secretsDir: dir, roster });
    expect(result).toEqual({ ok: false, reason: "secret_not_ascii", role: "web" });
  });

  test("roles_without_password_file_skipped", async () => {
    const roster = [{ name: "admin", passwordFrom: null }];
    const result = await syncRolePasswords({ connection: NOWHERE, secretsDir: dir, roster });
    expect(result).toEqual({ ok: true, roles: [] });
  });
});
