// The session work behind signing out (P2.08a; book phase-2.md "POST /logout" step 4 and "POST /logout/everywhere"
// steps 3–4; plan §5.3 "Logout"). The count is the book's SELECT, run in the same transaction as the delete so a
// failed count rolls the delete back. It lives here, not on infrastructure/session: that folder is trusted base
// (SE-6, CODEOWNERS) and cannot share a pull request with these routes.
import type { Did } from "@unset/domains-identity";
import { type Pool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import type { Session, SessionDb, SessionStore } from "@unset/infrastructure-session";

/** How many of `did`'s sessions remain. `count(*)::int` is a number (node-pg 8.23, oid 23). */
export async function remainingSessions(db: SessionDb, did: Did): Promise<number> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM app.session WHERE did = $1", [did]);
  const n = rows[0]?.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new Error("session count missing");
  return n;
}

export function browserLogout(options: {
  readonly pool: Pool;
  readonly sessions: SessionStore;
  /** `@atproto/oauth-client` 0.8.9 `OAuthClient.revoke` (dist/oauth-client.js). Deletes the stored set in a `finally`. */
  readonly revoke: (did: Did) => Promise<void>;
}): {
  destroySession: (session: Session, deadline: AbortSignal) => Promise<number>;
  destroyAllSessions: (session: Session, deadline: AbortSignal) => Promise<number>;
  revokeGrant: (did: Did) => Promise<void>;
  deleteTokenSet: (did: Did, deadline: AbortSignal) => Promise<void>;
} {
  const { pool, sessions, revoke } = options;
  return {
    destroySession: (session, deadline) =>
      withTransaction(pool, deadline, async (tx) => {
        await sessions.destroy(tx, session.idHash);
        return remainingSessions(tx, session.did);
      }),
    destroyAllSessions: (session, deadline) =>
      withTransaction(pool, deadline, (tx) => sessions.destroyAllForDid(tx, session.did, "user_signout_all")),
    revokeGrant: (did) => revoke(did),
    deleteTokenSet: (did, deadline) =>
      withClient(pool, deadline, (db) => db.query("DELETE FROM app.oauth_session WHERE did = $1", [did])).then(
        () => undefined,
      ),
  };
}
