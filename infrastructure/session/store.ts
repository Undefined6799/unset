// The browser session store (P2.03; plan section 2 rule 7, section 5.3 "Sessions"). A cookie is 32 random bytes in
// base64url, and app.session keys a session by sha256 of those bytes, so a stolen row is not a cookie. Every expiry
// is judged by the database's now(), one clock for every replica. A session lasts only while its DID has a stored
// OAuth token set (P2.04s). create, destroy, destroyAllForDid, countLive and setEmailConfirmed run on the client the
// caller passes (its transaction, so a sign-in commits with the rest of its work); read takes its own connections
// through `withDb`, outside any transaction the handler holds (a GET handler's is read-only, P1.07).
// Like infrastructure/audit, this workspace never imports the driver or infrastructure/postgres (architecture matrix
// row `infrastructure`): the composition root passes postgres's withClient over the web pool as `withDb`.
// It moved here from infrastructure/postgres/session/ (P2.03c). The comment in migration 0011 still names the old
// folder; applied migrations are locked by their checksums (infrastructure/postgres/migrate.ts), so it stays.
import { createHash, randomBytes } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import { BELL_READ, type Entry, type NotificationId, type Reason } from "@unset/domains-notifications";
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

/** Idle and absolute lifetimes, and the least time between two touches, in seconds (interfaces/web config). */
export type SessionLimits = { readonly idleS: number; readonly absoluteS: number; readonly touchIntervalS: number };
export type Session = {
  readonly did: Did;
  readonly idHash: Buffer;
  readonly createdAt: Date;
  /** P2.11's cache of the PDS's answer; null until checked. */
  readonly emailConfirmed: boolean | null;
  /**
   * When `emailConfirmed` was last written (P2.11's `email_checked_at`); null until checked. `read` always sets it,
   * so the gate needs no second query for it (P2.03m). A session built without it reads as never checked.
   */
  readonly emailCheckedAt?: Date | null;
  /**
   * The origin of the sign-in server OAuth recorded when this session was created (ADR 0048, P2.03o); null for a
   * session created before the column or with no storable origin. `read` always sets it.
   */
  readonly issuerOrigin?: string | null;
  /**
   * The bell's newest BELL_READ notifications this browser may see, newest first (P2.27, ADR 0079), read with the
   * session so a page spends no statement of its own on the bell. `read` always sets it; a session built without it
   * has none.
   */
  readonly inbox?: readonly Entry[];
};
/** One request as read sees it: `key` (the Request) scopes the memo; `cookieValue` is null when none was sent. */
export type SessionRequest = {
  readonly key: object;
  readonly cookieValue: string | null;
  readonly deadline: AbortSignal | null;
};
/** The request's session, and whether the response must clear the cookie (unknown, malformed or expired). */
export type SessionRead = { readonly session: Session | null; readonly clearCookie: boolean };
/**
 * Why every session of a DID ends: app.end_sessions_for_did's closed list (migration 0014), shared with P3.06. Phase 2
 * uses user_signout_all (P2.08), underage (P2.12) and auth_dead (P2.07); session.reasons_match_check keeps the two equal.
 */
export const END_SESSIONS_REASONS = [
  "deactivated",
  "takendown",
  "suspended",
  "deleted",
  "unknown",
  "mod_suspended",
  "mod_end_sessions",
  "user_signout_all",
  "underage",
  "auth_dead",
] as const;
export type EndSessionsReason = (typeof END_SESSIONS_REASONS)[number];

export type SessionStore = {
  create(db: Db, did: Did, options?: CreateOptions): Promise<CreatedSession>;
  read(request: SessionRequest): Promise<SessionRead>;
  destroy(db: Db, idHash: Buffer): Promise<void>;
  destroyAllForDid(tx: Db, did: Did, why: EndSessionsReason): Promise<number>;
  countLive(db: Db, did: Did): Promise<number>;
  setEmailConfirmed(db: Db, target: Buffer | { readonly did: Did }, value: boolean): Promise<void>;
  sweep(db: Db): Promise<number>;
};
/**
 * `replacingCookie` names the browser's previous session, which dies first. `issuerOrigin` is the sign-in server's
 * origin, already checked by the caller (interfaces/web sign-in-state.ts `issuerOrigin`); it is written once and never
 * updated.
 */
export type CreateOptions = { readonly replacingCookie?: string; readonly issuerOrigin?: string | null };
/** `idHash` names the new row for a later write on it (the callback's email answer, P2.06 step 11); never logged. */
export type CreatedSession = { readonly cookieValue: string; readonly idHash: Buffer; readonly expiresAt: Date };

const ID_BYTES = 32;
/** Canonical unpadded base64url of 32 bytes. */
const COOKIE_VALUE = /^[A-Za-z0-9_-]{43}$/;
/**
 * The shape migration 0019's check on app.session.issuer_origin accepts. An origin outside it is stored as null, so
 * the column check never fails a sign-in; the account pages then read the token set, as they do for an older session.
 */
const STORABLE_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const storableOrigin = (origin: string | null | undefined): string | null =>
  origin != null && STORABLE_ORIGIN.test(origin) ? origin : null;
/**
 * The one rule for a row's lifetimes, as SQL over `s` (app.session) with the idle limit bound as $2: not past its
 * absolute expiry and seen within the idle limit, both by the database's now(). `lookup` and `countLive` both read it,
 * so the last browser's count cannot drift from what signs a browser in (P2.08c). The columns are NOT NULL
 * (migration 0011), so `NOT` of it is exactly "expired".
 */
const WITHIN_LIFETIMES = "now() <= s.absolute_expires_at AND now() <= s.last_seen_at + make_interval(secs => $2)";
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
  email_checked_at: Date | null;
  issuer_origin: string | null;
  expired: boolean;
  touch_due: boolean;
  has_token_set: boolean;
  inbox: InboxRow[];
};
/** One of app.inbox's rows as the lookup's json_agg writes it; `sent_ms` is milliseconds since the epoch. */
type InboxRow = { id: string; reason: string; topic: string | null; sent_ms: number; seen: boolean };

const entryOf = (row: InboxRow): Entry => ({
  id: row.id as NotificationId,
  reason: row.reason as Reason, // app.notification's CHECK holds the same closed list as REASONS
  topic: row.topic,
  sentAt: new Date(row.sent_ms),
  seen: row.seen,
});

export function createSessionStore(options: {
  readonly withDb: WithSessionDb;
  readonly limits: SessionLimits;
  readonly log: Logger;
}): SessionStore {
  const { withDb, limits, log } = options;
  const memo = new WeakMap<object, Promise<SessionRead>>();

  /** Rotation first (this browser's previous session dies, whoever it belonged to), then a fresh id. */
  async function create(db: Db, did: Did, { replacingCookie, issuerOrigin }: CreateOptions = {}) {
    const previous = replacingCookie === undefined ? null : idHashOf(replacingCookie);
    if (previous !== null) await destroy(db, previous);
    // A repeated id (2^-256) violates the primary key, and the caller's transaction fails closed (P2.03 step 1c).
    const id = randomBytes(ID_BYTES);
    const idHash = sha256(id);
    const { rows } = await db.query<{ expires_at: Date }>(
      "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at, issuer_origin) " +
        "VALUES ($1, $2, now(), now(), now() + make_interval(secs => $3), $4) " +
        "RETURNING absolute_expires_at AS expires_at",
      [idHash, did, limits.absoluteS, storableOrigin(issuerOrigin)],
    );
    const expiresAt = (rows[0] as { expires_at: Date }).expires_at;
    return { cookieValue: id.toString("base64url"), idHash, expiresAt };
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
      if (found !== undefined && (found.expired || !found.has_token_set)) await destroy(db, idHash);
      return found;
    }).catch(unavailable);
    if (row === undefined || row.expired || !row.has_token_set) return CLEAR;
    if (row.touch_due) await touch(idHash, deadline);
    const session = {
      did: row.did,
      idHash,
      createdAt: row.created_at,
      emailConfirmed: row.email_confirmed,
      emailCheckedAt: row.email_checked_at,
      issuerOrigin: row.issuer_origin,
      inbox: row.inbox.map(entryOf),
    };
    return { session, clearCookie: false };
  }

  /**
   * The session row, with whether its DID still has a stored OAuth token set (P2.04s): the library deletes the set when
   * the grant is dead (refresh refused, revoked, sign out everywhere), and that ends every browser session on it. The
   * library's own delete hook cannot do this, as it also fires on every sign-in (P2.04 step 7).
   * P2.03t (migration 0024, ADR 0049): the database now deletes those rows with the set (a foreign key with ON DELETE
   * CASCADE), so no row here can lack one. The check stays: it costs one index probe and holds if the constraint is
   * ever dropped.
   * The bell's entries come along through app.inbox (migration 0036), the one place the rule for what a browser may
   * see is written: one index probe on the member's newest rows, so a page needs no statement of its own for the bell.
   */
  async function lookup(db: Db, idHash: Buffer): Promise<SessionRow | undefined> {
    const { rows } = await db.query<SessionRow>(
      "SELECT s.did, s.created_at, s.email_confirmed, s.email_checked_at, s.issuer_origin, " +
        `NOT (${WITHIN_LIFETIMES}) AS expired, ` +
        "now() - s.last_seen_at > make_interval(secs => $3) AS touch_due, " +
        "EXISTS (SELECT 1 FROM app.oauth_session o WHERE o.did = s.did) AS has_token_set, " +
        "(SELECT coalesce(json_agg(json_build_object('id', i.id, 'reason', i.reason, 'topic', i.topic, " +
        "'sent_ms', floor(extract(epoch FROM i.created_at) * 1000), 'seen', i.seen) ORDER BY i.created_at DESC, i.id), " +
        "'[]') FROM (SELECT i.id, i.reason, i.topic, i.created_at, i.seen FROM app.inbox i WHERE i.viewer = s.id_hash " +
        "AND i.did = s.did ORDER BY i.created_at DESC, i.id LIMIT $4) i) AS inbox " +
        "FROM app.session s WHERE s.id_hash = $1",
      [idHash, limits.idleS, limits.touchIntervalS, BELL_READ],
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

  /**
   * Ends every session of `did`, and its token set unless `why` is deactivated, inside the caller's transaction, so
   * the caller's own change commits with it. The SQL is the definer's only (migration 0014); it returns the count.
   */
  async function destroyAllForDid(tx: Db, did: Did, why: EndSessionsReason) {
    const { rows } = await tx.query<{ ended: number }>("SELECT app.end_sessions_for_did($1, $2) AS ended", [did, why]);
    return (rows[0] as { ended: number }).ended;
  }

  /**
   * How many of `did`'s sessions can still sign a browser in (P2.08c): within both lifetimes and with a stored token
   * set, as `read` judges them. On the caller's client, so inside a transaction it counts that transaction's own
   * delete. A count that is not a whole number throws, so a broken read never passes for "no browser left".
   */
  async function countLive(db: Db, did: Did) {
    const { rows } = await db.query<{ n: unknown }>(
      `SELECT count(*)::int AS n FROM app.session s WHERE s.did = $1 AND ${WITHIN_LIFETIMES} ` +
        "AND EXISTS (SELECT 1 FROM app.oauth_session o WHERE o.did = s.did)",
      [did, limits.idleS],
    );
    const n = rows[0]?.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new Error("session count missing");
    return n;
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

  return { create, read, destroy, destroyAllForDid, countLive, setEmailConfirmed, sweep };
}

function unavailable(error: unknown): never {
  throw error instanceof AppError ? error : new AppError("service.unavailable", { cause: error });
}
