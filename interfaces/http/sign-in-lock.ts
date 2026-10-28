// One sign-in at a time per account, against the last browser's sign-out (P1.36y; security review 2026-10-28).
//
// @atproto/oauth-client 0.8.9 `callback` revokes the account's stored token set and deletes it before it stores the
// new one (dist/oauth-client.js:196-211). Two things went wrong around that:
// - another browser of the same account that loaded a page between the delete and the store found no token set, and
//   the session store ended its session for good (infrastructure/session/store.ts `readOnce`);
// - a last browser signing out at the same moment could count no sessions, then revoke the set the new sign-in had
//   just stored.
// So inside `during`, the sign-in's first token-set write takes the account's lock (`LockNamespace.signIn`) and holds
// it until `during` ends, after the session row exists; a delete there waits for that end and is dropped when a store
// follows it, so the old set is replaced in place. Sign-out recounts under the same lock (logout-sessions.ts).
//
// Lock order: the library reads a token set inside its own per-DID refresh lock (`requestLock`, session-getter.js
// `get`) but writes and deletes outside it. Only writes and deletes take this lock, so a holder may take the refresh
// lock and never the reverse, on both paths.
import { AsyncLocalStorage } from "node:async_hooks";

/** Runs `fn` while holding the account's lock in every replica (infrastructure/postgres `withAdvisoryLock`). */
export type DidLock = <T>(did: string, fn: () => Promise<T>) => Promise<T>;
/** The OAuth library's session store, as it calls it (NodeSavedSessionStore). */
export type TokenSetStore<V> = {
  get(did: string, options?: { signal?: AbortSignal }): Promise<V | undefined>;
  set(did: string, value: V): Promise<void>;
  del(did: string): Promise<void>;
};

type Held = { readonly did: string; readonly release: () => void; ended: Promise<unknown>; deleteAtEnd: boolean };
type Scope = { held: Promise<Held> | null };

export function createSignInLock<V>(options: { readonly store: TokenSetStore<V>; readonly lockDid: DidLock }): {
  tokenSets: TokenSetStore<V>;
  during: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const { store, lockDid } = options;
  const scopes = new AsyncLocalStorage<Scope>();

  /** Resolves once the lock is held; the lock is let go when `release` is called. A failed wait rejects. */
  function take(did: string): Promise<Held> {
    return new Promise((resolve, reject) => {
      let release = (): void => undefined;
      const released = new Promise<void>((done) => {
        release = done;
      });
      const held: Held = { did, release, ended: Promise.resolve(), deleteAtEnd: false };
      held.ended = lockDid(did, async () => {
        resolve(held);
        await released;
      });
      held.ended.catch(reject);
    });
  }

  async function hold(scope: Scope, did: string): Promise<Held> {
    scope.held ??= take(did);
    const held = await scope.held;
    if (held.did !== did) throw new Error("sign-in lock: one account per sign-in");
    return held;
  }

  const tokenSets: TokenSetStore<V> = {
    // Reads never take the lock: the library reads inside its refresh lock (see the lock order above).
    get: (did, read) => store.get(did, read),
    async set(did, value) {
      const scope = scopes.getStore();
      if (scope !== undefined) (await hold(scope, did)).deleteAtEnd = false;
      await store.set(did, value);
    },
    async del(did) {
      const scope = scopes.getStore();
      if (scope === undefined) return store.del(did);
      (await hold(scope, did)).deleteAtEnd = true;
    },
  };

  async function during<T>(fn: () => Promise<T>): Promise<T> {
    const scope: Scope = { held: null };
    try {
      return await scopes.run(scope, fn);
    } finally {
      const held = scope.held === null ? null : await scope.held.catch(() => null);
      if (held !== null) {
        try {
          if (held.deleteAtEnd) await store.del(held.did);
        } finally {
          held.release();
          await held.ended.catch(() => undefined);
        }
      }
    }
  }

  return { tokenSets, during };
}
