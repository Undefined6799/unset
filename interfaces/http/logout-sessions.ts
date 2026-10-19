// The session work behind signing out (P2.08a; book phase-2.md "POST /logout" step 4; plan §5.3 "Logout"). P2.08d
// removed "sign out everywhere" and its destroy-all here. The count is the book's SELECT, run in the same transaction as the delete so a
// failed count rolls the delete back. It lives here, not on infrastructure/session: that folder is trusted base
// (SE-6, CODEOWNERS) and cannot share a pull request with these routes.
import type { Did } from "@unset/domains-identity";
import { type Pool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import type { Session, SessionDb, SessionStore } from "@unset/infrastructure-session";

/**
 * How many of `did`'s sessions can still sign a browser in (P2.08c). A row past its idle or absolute expiry is not
 * one, nor is a row whose DID has no stored token set: the store reads both as signed out (infrastructure/session/
 * store.ts, `lookup`'s `expired` and `has_token_set`). No sweep deletes them until the jobs process exists, so counting
 * them would keep the grant after the last real browser signs out (readiness review 2026-10-19, S2). The conditions
 * repeat the store's, because that folder is trusted base; the integration test pins both boundaries.
 * `count(*)::int` is a number (node-pg 8.23, oid 23).
 */
export async function remainingSessions(db: SessionDb, did: Did, idleS: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM app.session s WHERE s.did = $1 " +
      "AND now() <= s.absolute_expires_at AND now() <= s.last_seen_at + make_interval(secs => $2) " +
      "AND EXISTS (SELECT 1 FROM app.oauth_session o WHERE o.did = s.did)",
    [did, idleS],
  );
  const n = rows[0]?.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new Error("session count missing");
  return n;
}

export function browserLogout(options: {
  readonly pool: Pool;
  readonly sessions: SessionStore;
  /** The store's idle lifetime in seconds (SessionLimits.idleS), so a stale row is not counted as a browser. */
  readonly idleS: number;
  /** `@atproto/oauth-client` 0.8.9 `OAuthClient.revoke` (dist/oauth-client.js). Deletes the stored set in a `finally`. */
  readonly revoke: (did: Did) => Promise<void>;
}): {
  destroySession: (session: Session, deadline: AbortSignal) => Promise<number>;
  revokeGrant: (did: Did) => Promise<void>;
  deleteTokenSet: (did: Did, deadline: AbortSignal) => Promise<void>;
} {
  const { pool, sessions, idleS, revoke } = options;
  return {
    destroySession: (session, deadline) =>
      withTransaction(pool, deadline, async (tx) => {
        await sessions.destroy(tx, session.idHash);
        return remainingSessions(tx, session.did, idleS);
      }),
    revokeGrant: (did) => revoke(did),
    deleteTokenSet: (did, deadline) =>
      withClient(pool, deadline, (db) => db.query("DELETE FROM app.oauth_session WHERE did = $1", [did])).then(
        () => undefined,
      ),
  };
}
