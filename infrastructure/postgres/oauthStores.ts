// The OAuth client's state and session stores (P2.04; plan section 5.3 "OAuth client"), in the get/set/del shape
// @atproto/oauth-client-node 0.5.9 takes (`SimpleStore`, @atproto-labs/simple-store). Each value is sealed with the
// context of its own row (sealed-columns.json), so a dump yields nothing usable and a value moved to another row does
// not open. A row that does not open is deleted and reads as missing: an expired login for state, a new sign-in for a
// token set. Database errors are thrown; the library surfaces them and P2.07 treats them as transient.
import { SealError, type Sealer } from "@unset/infrastructure-seal";
import type { Logger } from "@unset/shared-log";
import { type Pool, withClient } from "./pool.ts";
import { sealedContext } from "./sealedColumns.ts";

export type SealedStore<V> = {
  get(key: string): Promise<V | undefined>;
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

export function createOAuthStateStore<V>(options: Options): SealedStore<V> {
  const context = (key: string) => sealedContext("app.oauth_state.sealed", key);
  const run = <T>(fn: Parameters<typeof withClient<T>>[2]) => withClient(options.pool, null, fn);
  const del = async (key: string) => {
    await run((db) => db.query("DELETE FROM app.oauth_state WHERE key = $1", [key]));
  };
  return {
    async get(key) {
      const { rows } = await run((db) =>
        db.query<{ sealed: string }>("SELECT sealed FROM app.oauth_state WHERE key = $1 AND expires_at > now()", [key]),
      );
      const sealed = rows[0]?.sealed;
      if (sealed === undefined) return undefined;
      const value = opened<V>(options.log, "state", () => options.sealer.unsealJson(sealed, context(key)));
      if (value === undefined) await del(key);
      return value;
    },
    async set(key, value) {
      await run(async (db) => {
        // An abandoned login never reaches del, and anyone may start one: each write purges the expired rows, so the
        // table holds only the last STATE_TTL_S of logins.
        await db.query("DELETE FROM app.oauth_state WHERE expires_at <= now()");
        await db.query(
          "INSERT INTO app.oauth_state (key, sealed, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3)) " +
            "ON CONFLICT (key) DO UPDATE SET sealed = EXCLUDED.sealed, expires_at = EXCLUDED.expires_at",
          [key, options.sealer.sealJson(value, context(key)), STATE_TTL_S],
        );
      });
    },
    del,
  };
}

/** What the session store reads of a token set: the client key id the library bound it to (`authMethod.kid`). */
type BoundToKey = { readonly authMethod: { readonly method: string; readonly kid?: string } };

export function createOAuthSessionStore<V extends BoundToKey>(options: Options): SealedStore<V> {
  const context = (did: string) => sealedContext("app.oauth_session.sealed", did);
  const run = <T>(fn: Parameters<typeof withClient<T>>[2]) => withClient(options.pool, null, fn);
  const del = async (did: string) => {
    await run((db) => db.query("DELETE FROM app.oauth_session WHERE did = $1", [did]));
  };
  return {
    async get(did) {
      const { rows } = await run((db) =>
        db.query<{ sealed: string }>("SELECT sealed FROM app.oauth_session WHERE did = $1", [did]),
      );
      const sealed = rows[0]?.sealed;
      if (sealed === undefined) return undefined;
      const value = opened<V>(options.log, "session", () => options.sealer.unsealJson(sealed, context(did)));
      if (value === undefined) await del(did);
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
