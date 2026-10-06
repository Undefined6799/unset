// Role password sync (P1.12p; plan section 5.2, CIS Postgres; architecture ruling 2026-10-06 P1.12 point 1). For each
// roster role whose entry names a password file, `migrator` sends `ALTER ROLE <role> PASSWORD '<SCRAM verifier>'`. The
// verifier is computed here, so the cleartext never reaches the server, its log or pg_stat_activity: PostgreSQL stores a
// password string already in SCRAM format as-is (https://www.postgresql.org/docs/18/sql-createrole.html, PASSWORD), in
// the form `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` with Base64 fields
// (https://www.postgresql.org/docs/18/catalog-pg-authid.html, rolpassword; RFC 5803). Rotation: change the secret file
// and run it again. It returns a typed result and logs nothing; no result or error carries a password.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadConfig, type Secret, secretFile } from "@unset/shared-config";
import pg from "pg";
import type { Connection } from "./config.ts";
import { inTransaction } from "./tx.ts";

/** PostgreSQL 18's default scram_iterations. */
const ITERATIONS = 4096;
const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const PASSWORD_FILE = /^pg_[a-z0-9_]+_password$/;
/** Printable ASCII, which SASLprep (RFC 4013 section 2) leaves unchanged, so the server derives the same keys. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const VERIFIER = /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;

export type RosterEntry = { readonly name: string; readonly passwordFrom: string | null };

export type PasswordSyncResult =
  | { readonly ok: true; readonly roles: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: "roster_invalid" | "secret_unreadable" | "secret_not_ascii" | "role_absent" | "database";
      /** The roster role at fault, when there is one. */
      readonly role?: string | undefined;
      readonly sqlstate?: string | undefined;
    };

export type PasswordSyncOptions = {
  /** A connection as `migrator`, which created the roster roles and so may set their passwords. */
  readonly connection: Connection;
  /** The folder holding the password files (Compose: /run/secrets). */
  readonly secretsDir: string;
  /** Default: infrastructure/postgres/roles.json. */
  readonly roster?: readonly RosterEntry[];
};

const hmac = (key: Buffer, text: string): Buffer => createHmac("sha256", key).update(text).digest();

/** The SCRAM-SHA-256 verifier PostgreSQL stores for `password` (RFC 5802 section 3, RFC 7677). */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = ITERATIONS): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const storedKey = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** The one statement sent per role: the name quoted as an identifier, the verifier as a literal; never a password. */
export function alterRolePasswordSql(role: string, verifier: string): string {
  if (!ROLE_NAME.test(role) || !VERIFIER.test(verifier)) throw new Error("refused: not a role name or verifier");
  return `ALTER ROLE "${role}" PASSWORD '${verifier}'`;
}

const defaultRoster = (): RosterEntry[] =>
  JSON.parse(readFileSync(join(import.meta.dirname, "roles.json"), "utf8")) as RosterEntry[];

/** Reads every password file first, through the reader the services use (`secretFile`), so both see the same bytes. */
function readPasswords(roles: readonly RosterEntry[], dir: string): Map<string, Secret> | PasswordSyncResult {
  const passwords = new Map<string, Secret>();
  for (const role of roles) {
    const key = `PG_${role.name.toUpperCase()}_PASSWORD`;
    let secret: Secret;
    try {
      const cfg = loadConfig(defineConfig({ [key]: secretFile({ minBytes: 16 }) }), {
        [`${key}_FILE`]: join(dir, String(role.passwordFrom)),
      });
      secret = cfg[key] as Secret;
    } catch {
      return { ok: false, reason: "secret_unreadable", role: role.name };
    }
    if (!PRINTABLE_ASCII.test(secret.reveal())) return { ok: false, reason: "secret_not_ascii", role: role.name };
    passwords.set(role.name, secret);
  }
  return passwords;
}

/**
 * Sets every roster password, all or none: the roster is checked, every file read and every role found before the
 * first ALTER ROLE, and the statements run in one transaction.
 */
export async function syncRolePasswords(options: PasswordSyncOptions): Promise<PasswordSyncResult> {
  const roles = (options.roster ?? defaultRoster()).filter((role) => role.passwordFrom !== null);
  const invalid = roles.find((r) => !ROLE_NAME.test(r.name) || !PASSWORD_FILE.test(String(r.passwordFrom)));
  if (invalid) return { ok: false, reason: "roster_invalid", role: invalid.name };
  const passwords = readPasswords(roles, options.secretsDir);
  if (!(passwords instanceof Map)) return passwords;
  if (roles.length === 0) return { ok: true, roles: [] };

  const client = new pg.Client(options.connection);
  try {
    await client.connect();
    return await inTransaction(client, async () => {
      const names = roles.map((role) => role.name);
      const found = await client.query<{ rolname: string }>(
        "SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])",
        [names],
      );
      const present = new Set(found.rows.map((row) => row.rolname));
      const absent = names.find((name) => !present.has(name));
      if (absent) return { ok: false, reason: "role_absent", role: absent } as const;
      for (const name of names) {
        await client.query(alterRolePasswordSql(name, scramVerifier((passwords.get(name) as Secret).reveal())));
      }
      return { ok: true, roles: names } as const;
    });
  } catch (error) {
    // The SQLSTATE only: a server message can quote the statement.
    const code = (error as { code?: unknown }).code;
    return { ok: false, reason: "database", sqlstate: typeof code === "string" ? code : undefined };
  } finally {
    await client.end().catch(() => undefined);
  }
}
