// The durable single-use store (P1.16; plan section 2 rule 6, section 5.2 jti replay). A login nonce, a module
// identity assertion or a service-auth `jti` works once: consuming it is one UPDATE in Postgres, whose row lock lets
// exactly one of any number of concurrent callers through, and the database clock decides expiry. Only a SHA-256 of
// a token is stored, so a database read yields nothing usable.
import { createHash, randomBytes } from "node:crypto";
import type { Logger } from "@unset/shared-log";
import type { PoolClient } from "../pool.ts";

/** Each purpose with its longest life in seconds. Later steps add purposes. */
export const PURPOSES = {
  "login.nonce": 600,
  "module.assertion": 120,
  "service_auth.jti": 120,
  "invite.claim": 600,
  "email.interstitial": 600,
  "chat.openid": 3600,
} as const;
export type Purpose = keyof typeof PURPOSES;

/** Where the statements run: a pooled client, or a transaction's. */
export type Db = Pick<PoolClient, "query">;
/** What a token is bound to at issue; consume must present the same, or it fails and the token stays usable. */
export type Binding = { readonly bindDid?: string; readonly bindExtra?: Uint8Array };
/** An externally minted id: a JWT `jti` is unique only per issuer, so the issuer is part of the key. */
export type ExternalId = { readonly issuer: string; readonly externalId: string };

export type SingleUseStore = {
  issue(db: Db, purpose: Purpose, options: Binding & { readonly ttlS: number }): Promise<string>;
  consume(db: Db, purpose: Purpose, token: string, binding?: Binding): Promise<"ok" | "invalid">;
  claim(db: Db, purpose: Purpose, id: ExternalId, expiresAt: Date): Promise<boolean>;
  sweep(db: Db): Promise<number>;
};

const TOKEN_BYTES = 32;
/** Canonical unpadded base64url of 32 bytes. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UNIQUE_VIOLATION = "23505";

const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();
/** The log `kind` for a purpose: the logger's word rule refuses a dot (`login.nonce` → `login_nonce`). */
const kindOf = (purpose: Purpose): string => purpose.replaceAll(".", "_");

/** The token's bytes, or null for anything that is not one this store issued. */
function decodeToken(token: string): Buffer | null {
  if (!TOKEN.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  return bytes.length === TOKEN_BYTES && bytes.toString("base64url") === token ? bytes : null;
}

/** DID syntax as atproto accepts it (https://atproto.com/specs/did, "DID Syntax"): method, then an identifier that
 * may hold colons (a did:web path) and never ends in one. */
const ISSUER = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const ISSUER_MAX = 2048;
/** A `jti` or other external id: printable ASCII without spaces, at most 256 characters. */
const EXTERNAL_ID = /^[\x21-\x7e]{1,256}$/;

/**
 * The key of an externally minted id: sha256 of the JSON array [purpose, issuer, externalId] (architecture record
 * 2026-10-06 p116, Amendment 20:15Z). JSON keeps the parts apart: issuers are DIDs, which hold colons, so a plain
 * `purpose:issuer:id` join could make two different ids one key. Each part is checked first and used exactly as given,
 * never normalised. Changing this encoding orphans every stored key, so it needs its own migration step.
 */
function claimKey(purpose: Purpose, id: ExternalId): Buffer {
  const { issuer, externalId } = id as { issuer: unknown; externalId: unknown };
  if (typeof purpose !== "string" || !Object.hasOwn(PURPOSES, purpose))
    throw new RangeError("single-use: unknown purpose");
  if (typeof issuer !== "string" || issuer.length > ISSUER_MAX || !ISSUER.test(issuer)) {
    throw new RangeError("single-use: issuer is not a DID");
  }
  if (typeof externalId !== "string" || !EXTERNAL_ID.test(externalId)) {
    throw new RangeError("single-use: external id is not 1..256 printable ASCII characters");
  }
  return sha256(JSON.stringify([purpose, issuer, externalId]));
}

export function createSingleUseStore(options: {
  readonly log: Logger;
  readonly random?: (bytes: number) => Buffer;
}): SingleUseStore {
  const { log, random = randomBytes } = options;

  async function issue(db: Db, purpose: Purpose, { ttlS, bindDid, bindExtra }: Binding & { ttlS: number }) {
    if (!Number.isInteger(ttlS) || ttlS < 1 || ttlS > PURPOSES[purpose]) {
      throw new RangeError(`single-use: ttlS must be 1..${PURPOSES[purpose]} for ${purpose}`);
    }
    // A repeated id is astronomically unlikely; one retry with a new token, then the error stands.
    for (let attempt = 1; ; attempt++) {
      const token = random(TOKEN_BYTES);
      try {
        await db.query(
          "INSERT INTO app.single_use (id, purpose, bind_did, bind_extra, expires_at) " +
            "VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))",
          [sha256(token), purpose, bindDid ?? null, bindExtra ?? null, ttlS],
        );
        return token.toString("base64url");
      } catch (error) {
        if (attempt > 1 || (error as { code?: unknown }).code !== UNIQUE_VIOLATION) throw error;
      }
    }
  }

  async function consume(db: Db, purpose: Purpose, token: string, binding: Binding = {}) {
    const raw = decodeToken(token);
    if (raw === null) return reject("unknown", purpose);
    const id = sha256(raw);
    const consumed = await db.query(
      "UPDATE app.single_use SET consumed_at = now() WHERE id = $1 AND purpose = $2 AND consumed_at IS NULL " +
        "AND expires_at > now() AND bind_did IS NOT DISTINCT FROM $3 AND bind_extra IS NOT DISTINCT FROM $4",
      [id, purpose, binding.bindDid ?? null, binding.bindExtra ?? null],
    );
    if (consumed.rowCount === 1) return "ok";
    // Only to choose the log reason; the caller learns `invalid` whatever it is.
    const { rows } = await db.query<{ purpose: string; consumed: boolean; expired: boolean }>(
      "SELECT purpose, consumed_at IS NOT NULL AS consumed, expires_at <= now() AS expired " +
        "FROM app.single_use WHERE id = $1",
      [id],
    );
    const [row] = rows;
    if (row === undefined) return reject("unknown", purpose);
    if (row.purpose !== purpose) return reject("purpose_mismatch", purpose);
    if (row.consumed) return reject("reused", purpose);
    return reject(row.expired ? "expired" : "bind_mismatch", purpose);
  }

  function reject(reason: string, purpose: Purpose): "invalid" {
    log.warn("single_use.rejected", { reason, kind: kindOf(purpose) });
    return "invalid";
  }

  async function claim(db: Db, purpose: Purpose, id: ExternalId, expiresAt: Date) {
    const key = claimKey(purpose, id);
    // Inserted already consumed: the insert is the check, and ON CONFLICT makes every later claim a no-op.
    const { rows } = await db.query<{ clamped: boolean }>(
      "INSERT INTO app.single_use (id, purpose, expires_at, consumed_at) " +
        "VALUES ($1, $2, LEAST($3::timestamptz, now() + make_interval(secs => $4)), now()) " +
        "ON CONFLICT (id) DO NOTHING RETURNING expires_at < $3::timestamptz AS clamped",
      [key, purpose, expiresAt, PURPOSES[purpose]],
    );
    const [row] = rows;
    if (row?.clamped) log.info("single_use.claim_clamped", { kind: kindOf(purpose) });
    return row !== undefined;
  }

  /** Deletes rows a day past expiry; a replay after that finds no row and is still refused. Run as `retention`. */
  async function sweep(db: Db) {
    const result = await db.query("DELETE FROM app.single_use WHERE expires_at < now() - interval '1 day'");
    return result.rowCount ?? 0;
  }

  return { issue, consume, claim, sweep };
}
