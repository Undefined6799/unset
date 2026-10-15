// The browser session store (P2.03; plan section 2 rule 7, section 5.3 "Sessions"). A cookie is 32 random bytes in
// base64url, and app.session keys a session by sha256 of those bytes, so a stolen row is not a cookie. Every expiry
// is judged by the database's now(), one clock for every replica. create, destroy and setEmailConfirmed run on the
// client the caller passes (its transaction, so a sign-in commits with the rest of its work); read takes its own
// connections through `withDb`, outside any transaction the handler holds (a GET handler's is read-only, P1.07).
// Like infrastructure/audit, this workspace never imports the driver or infrastructure/postgres (architecture matrix
// row `infrastructure`): the composition root passes postgres's withClient over the web pool as `withDb`.
// It moved here from infrastructure/postgres/session/ (P2.03c). The comment in migration 0011 still names the old
// folder; applied migrations are locked by their checksums (infrastructure/postgres/migrate.ts), so it stays.
import { createHash, randomBytes } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import { AppError } from "@unset/shared-errors";
import type { Logger } from "@unset/shared-log";

/** A query on a client the caller holds; a pg PoolClient satisfies it as it is. */
export type SessionDb = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
};
/** Runs `fn` on a pooled client of its own within `deadline` (postgres's `withClient` over the web pool). */
export type WithSessionDb = <T>(deadline: AbortSignal | null, fn: (db: SessionDb) => Promise<T>) => Promise<T>;
type Db = SessionDb;

/** Idle and absolute lifetimes, and the least time between two touches, in seconds (interfaces/http config). */
export type SessionLimits = { readonly idleS: number; readonly absoluteS: number; readonly touchIntervalS: number };
export type Session = {
  readonly did: Did;
  readonly idHash: Buffer;
  readonly createdAt: Date;
  /** P2.11's cache of the PDS's answer; null until checked. */
  readonly emailConfirmed: boolean | null;
};
/** One request as read sees it: `key` (the Request) scopes the memo; `cookieValue` is null when none was sent. */
export type SessionRequest = {
  readonly key: object;
  readonly cookieValue: string | null;
  readonly deadline: AbortSignal | null;
};
/** The request's session, and whether the response must clear the cookie (unknown, malformed or expired). */
export type SessionRead = { readonly session: Session | null; readonly clearCookie: boolean };

export type SessionStore = {
  create(db: Db, did: Did, options?: { readonly replacingCookie?: string }): Promise<CreatedSession>;
  read(request: SessionRequest): Promise<SessionRead>;
  destroy(db: Db, idHash: Buffer): Promise<void>;
  setEmailConfirmed(db: Db, target: Buffer | { readonly did: Did }, value: boolean): Promise<void>;
  sweep(db: Db): Promise<number>;
};
export type CreatedSession = { readonly cookieValue: string; readonly expiresAt: Date };

const ID_BYTES = 32;
/** Canonical unpadded base64url of 32 bytes. */
const COOKIE_VALUE = /^[A-Za-z0-9_-]{43}$/;
const UNIQUE_VIOLATION = "23505";
const NONE: SessionRead = { session: null, clearCookie: false };
const CLEAR: SessionRead = { session: null, clearCookie: true };

const sha256 = (data: Uint8Array): Buffer => createHash("sha256").update(data).digest();

/** sha256 of the cookie's bytes, or null for anything that is not a value this store issued. */
function idHashOf(cookieValue: string): Buffer | null {
  if (!COOKIE_VALUE.test(cookieValue)) return null;
  const bytes = Buffer.from(cookieValue, "base64url");
  return bytes.length === ID_BYTES && bytes.toString("base64url") === cookieValue ? sha256(bytes) : null;
}

/** `did` comes from a `types.did` column, which holds only DIDs that parsed when they were written. */
type SessionRow = {
  did: Did;
  created_at: Date;
  email_confirmed: boolean | null;
  expired: boolean;
  touch_due: boolean;
};

export function createSessionStore(options: {
  readonly withDb: WithSessionDb;
  readonly limits: SessionLimits;
  readonly log: Logger;
  readonly random?: (bytes: number) => Buffer;
}): SessionStore {
  const { withDb, limits, log, random = randomBytes } = options;
  const memo = new WeakMap<object, Promise<SessionRead>>();

  /** Rotation first (this browser's previous session dies, whoever it belonged to), then a fresh id. */
  async function create(db: Db, did: Did, { replacingCookie }: { readonly replacingCookie?: string } = {}) {
    const previous = replacingCookie === undefined ? null : idHashOf(replacingCookie);
    if (previous !== null) await destroy(db, previous);
    // A repeated id is astronomically unlikely (2^-256); one retry with a new id, then the error stands.
    for (let attempt = 1; ; attempt++) {
      const id = random(ID_BYTES);
      try {
        const { rows } = await db.query<{ expires_at: Date }>(
          "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at) " +
            "VALUES ($1, $2, now(), now(), now() + make_interval(secs => $3)) RETURNING absolute_expires_at AS expires_at",
          [sha256(id), did, limits.absoluteS],
        );
        return { cookieValue: id.toString("base64url"), expiresAt: (rows[0] as { expires_at: Date }).expires_at };
      } catch (error) {
        if (attempt > 1 || (error as { code?: unknown }).code !== UNIQUE_VIOLATION) throw error;
      }
    }
  }

  /**
   * One database read per request: the result is kept against the request's key. It is a snapshot taken at the
   * request's first read, so a handler that calls create or destroy reads no session after it in the same request:
   * the response carries the change, and the next request reads it.
   */
  function read(request: SessionRequest): Promise<SessionRead> {
    const known = memo.get(request.key);
    if (known !== undefined) return known;
    const result = readOnce(request);
    memo.set(request.key, result);
    return result;
  }

  async function readOnce({ cookieValue, deadline }: SessionRequest): Promise<SessionRead> {
    if (cookieValue === null) return NONE;
    const idHash = idHashOf(cookieValue);
    if (idHash === null) return CLEAR;
    // A database error throws: the route answers 503 and the cookie stays, so a blip never signs anyone out, and no
    // route that needs a session falls back to anonymous.
    const row = await withDb(deadline, async (db) => {
      const found = await lookup(db, idHash);
      if (found?.expired) await destroy(db, idHash);
      return found;
    }).catch(unavailable);
    if (row === undefined || row.expired) return CLEAR;
    if (row.touch_due) await touch(idHash, deadline);
    const session = { did: row.did, idHash, createdAt: row.created_at, emailConfirmed: row.email_confirmed };
    return { session, clearCookie: false };
  }

  async function lookup(db: Db, idHash: Buffer): Promise<SessionRow | undefined> {
    const { rows } = await db.query<SessionRow>(
      "SELECT did, created_at, email_confirmed, " +
        "now() > absolute_expires_at OR now() > last_seen_at + make_interval(secs => $2) AS expired, " +
        "now() - last_seen_at > make_interval(secs => $3) AS touch_due FROM app.session WHERE id_hash = $1",
      [idHash, limits.idleS, limits.touchIntervalS],
    );
    return rows[0];
  }

  /** Best effort, on its own connection: a failure is logged by kind and this request keeps its session. */
  async function touch(idHash: Buffer, deadline: AbortSignal | null) {
    await withDb(deadline, (db) =>
      db.query("UPDATE app.session SET last_seen_at = now() WHERE id_hash = $1", [idHash]),
    ).catch((error: unknown) => {
      log.warn("session.touch_failed", { kind: error instanceof Error ? error.name : "unknown" });
    });
  }

  async function destroy(db: Db, idHash: Buffer) {
    await db.query("DELETE FROM app.session WHERE id_hash = $1", [idHash]);
  }

  /** P2.11's cache, for one session or for every session of a DID. */
  async function setEmailConfirmed(db: Db, target: Buffer | { readonly did: Did }, value: boolean) {
    const set = "UPDATE app.session SET email_confirmed = $2, email_checked_at = now()";
    if (Buffer.isBuffer(target)) await db.query(`${set} WHERE id_hash = $1`, [target, value]);
    else await db.query(`${set} WHERE did = $1`, [target.did, value]);
  }

  /** Deletes every session past its idle or absolute expiry. Idempotent: concurrent runs are safe, so no lock (DA-4). */
  async function sweep(db: Db) {
    const result = await db.query(
      "DELETE FROM app.session WHERE absolute_expires_at < now() OR last_seen_at < now() - make_interval(secs => $1)",
      [limits.idleS],
    );
    const count = result.rowCount ?? 0;
    log.info("session.sweep", { count });
    return count;
  }

  return { create, read, destroy, setEmailConfirmed, sweep };
}

function unavailable(error: unknown): never {
  throw error instanceof AppError ? error : new AppError("service.unavailable", { cause: error });
}
