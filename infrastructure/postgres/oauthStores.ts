// The OAuth client's state and session stores (P2.04; plan section 5.3 "OAuth client"), in the get/set/del shape
// @atproto/oauth-client-node 0.5.9 takes (`SimpleStore`, @atproto-labs/simple-store). Each value is sealed with the
// context of its own row (sealed-columns.json), so a dump yields nothing usable and a value moved to another row does
// not open. A row that does not open is deleted and reads as missing: an expired login for state, a new sign-in for a
// token set. Database errors are thrown; the library surfaces them and P2.07 treats them as transient.
import { SealError, type Sealer } from "@unset/infrastructure-seal";
import type { Logger } from "@unset/shared-log";
import { type Pool, withClient } from "./pool.ts";
import { sealedContext } from "./sealedColumns.ts";

/**
 * `get`'s second argument is `GetOptions` from @atproto-labs/simple-store 0.5.1 (`dist/simple-store.d.ts`):
 * `{ signal?: AbortSignal }`. `set` and `del` take no options. The signal is the caller's deadline.
 */
export type SealedStore<V> = {
  get(key: string, options?: { readonly signal?: AbortSignal }): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  del(key: string): Promise<void>;
};
type Options = { readonly pool: Pool; readonly sealer: Sealer; readonly log: Logger };

/** How long an authorization may take, from the redirect to the callback. */
const STATE_TTL_S = 600;

/** The value, or undefined when its seal does not open (a wrong row, an unknown key id); any other error is thrown. */
function opened<V>(log: Logger, kind: "state" | "session", open: () => unknown): V | undefined {
  try {
    return open() as V;
  } catch (error) {
    if (!(error instanceof SealError)) throw error;
    log.warn("oauth.unseal_failed", { kind });
    return undefined;
  }
}

/** The state store, plus the sweep the hourly job runs: an abandoned login never reaches `del`. */
export type OAuthStateStore<V> = SealedStore<V> & { sweep(): Promise<number> };

export function createOAuthStateStore<V>(options: Options): OAuthStateStore<V> {
  const context = (key: string) => sealedContext("app.oauth_state.sealed", key);
  const run = <T>(fn: Parameters<typeof withClient<T>>[2], signal?: AbortSignal) =>
    withClient(options.pool, signal ?? null, fn);
  const del = async (key: string) => {
    await run((db) => db.query("DELETE FROM app.oauth_state WHERE key = $1", [key]));
  };
  return {
    async get(key, read) {
      const { rows } = await run(
        (db) =>
          db.query<{ sealed: string }>("SELECT sealed FROM app.oauth_state WHERE key = $1 AND expires_at > now()", [
            key,
          ]),
        read?.signal,
      );
      const sealed = rows[0]?.sealed;
      if (sealed === undefined) return undefined;
      const value = opened<V>(options.log, "state", () => options.sealer.unsealJson(sealed, context(key)));
      // Only the value that did not open: a newer one written meanwhile stays.
      if (value === undefined)
        await run((db) => db.query("DELETE FROM app.oauth_state WHERE key = $1 AND sealed = $2", [key, sealed]));
      return value;
    },
    async set(key, value) {
      await run((db) =>
        db.query(
          "INSERT INTO app.oauth_state (key, sealed, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3)) " +
            "ON CONFLICT (key) DO UPDATE SET sealed = EXCLUDED.sealed, expires_at = EXCLUDED.expires_at",
          [key, options.sealer.sealJson(value, context(key)), STATE_TTL_S],
        ),
      );
    },
    del,
    /**
     * Deletes every expired state and returns the count. Like the session sweep, it scans the table (no expiry index,
     * P2.03i ruling): the table holds at most an hour of abandoned logins, and no login write pays for the scan.
     */
    async sweep() {
      const result = await run((db) => db.query("DELETE FROM app.oauth_state WHERE expires_at <= now()"));
      return result.rowCount ?? 0;
    },
  };
}

/** What the session store reads of a token set: the client key id the library bound it to (`authMethod.kid`). */
type BoundToKey = { readonly authMethod: { readonly method: string; readonly kid?: string } };

export function createOAuthSessionStore<V extends BoundToKey>(options: Options): SealedStore<V> {
  const context = (did: string) => sealedContext("app.oauth_session.sealed", did);
  const run = <T>(fn: Parameters<typeof withClient<T>>[2], signal?: AbortSignal) =>
    withClient(options.pool, signal ?? null, fn);
  const del = async (did: string) => {
    await run((db) => db.query("DELETE FROM app.oauth_session WHERE did = $1", [did]));
  };
  return {
    async get(did, read) {
      const { rows } = await run(
        (db) => db.query<{ sealed: string }>("SELECT sealed FROM app.oauth_session WHERE did = $1", [did]),
        read?.signal,
      );
      const sealed = rows[0]?.sealed;
      if (sealed === undefined) return undefined;
      const value = opened<V>(options.log, "session", () => options.sealer.unsealJson(sealed, context(did)));
      // Only the value that did not open: a fresh token set another replica stored meanwhile stays.
      if (value === undefined)
        await run((db) => db.query("DELETE FROM app.oauth_session WHERE did = $1 AND sealed = $2", [did, sealed]));
      return value;
    },
    async set(did, value) {
      await run((db) =>
        db.query(
          "INSERT INTO app.oauth_session (did, sealed, client_kid, updated_at) VALUES ($1, $2, $3, now()) " +
            "ON CONFLICT (did) DO UPDATE SET sealed = EXCLUDED.sealed, client_kid = EXCLUDED.client_kid, " +
            "updated_at = EXCLUDED.updated_at",
          [did, options.sealer.sealJson(value, context(did)), value.authMethod.kid ?? ""],
        ),
      );
    },
    del,
  };
}
