// The count behind "the last browser revokes the grant" (P2.08c), on its own so a test can judge it against the session
// store at one instant, inside one transaction (tests/integration/web/sign-out.test.ts).
import type { Did } from "@unset/domains-identity";
import type { SessionDb } from "@unset/infrastructure-session";

/**
 * How many of `did`'s sessions can still sign a browser in (P2.08c): not a row past its idle or absolute expiry, nor
 * one whose DID has no stored token set, as the session store reads both as signed out (infrastructure/session
 * store.ts `lookup`). The conditions repeat the store's because that folder is trusted base.
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
