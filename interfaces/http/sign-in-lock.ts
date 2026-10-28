// One sign-in at a time per account, against the last browser's sign-out (P1.36y; security review 2026-10-28).
//
// @atproto/oauth-client 0.8.9 `callback` revokes the account's stored token set and deletes it before it stores the
// new one (dist/oauth-client.js:196-211). Two things went wrong around that:
// - another browser of the same account that loaded a page between the delete and the store found no token set, and
//   the session store ended its session for good (infrastructure/session/store.ts `readOnce`);
// - a last browser signing out at the same moment could count no sessions, then revoke the set the new sign-in had
//   just stored.
// So a sign-in (`during`) and a last-browser sign-out (`exclusive`) each hold the account's own OAuth lock, the one the
// library takes around every token read (`requestLock`, session-getter.js `get`), from its first use until the scope
// ends. Inside a scope the library's lock calls for that account reuse what the scope holds, so a scope uses one lock
// and one lock-pool client however often the library asks (Codex review on #1441: a second client from the same
// bounded pool could wait on itself). A delete inside a sign-in waits for the end and is dropped when a store follows
// it, so the old set is replaced in place.
import { AsyncLocalStorage } from "node:async_hooks";

/** `requestLock` as the OAuth library calls it: runs `fn` holding the named lock in every replica. */
export type NamedLock = <T>(name: string, fn: () => T | PromiseLike<T>) => Promise<T>;
/** The OAuth library's session store, as it calls it (NodeSavedSessionStore). */
export type TokenSetStore<V> = {
  get(did: string, options?: { signal?: AbortSignal }): Promise<V | undefined>;
  set(did: string, value: V): Promise<void>;
  del(did: string): Promise<void>;
};

/** The lock name session-getter.js `get` passes to `requestLock` for an account (@atproto/oauth-client 0.8.9). */
const lockName = (did: string): string => `@atproto-oauth-client-${did}`;

type Held = { readonly name: string; readonly release: () => void; ended: Promise<unknown> };
type Scope = { held: Promise<Held> | null; deleteAtEnd: string | null };

export function createSignInLock<V>(options: { readonly store: TokenSetStore<V>; readonly lock: NamedLock }): {
  tokenSets: TokenSetStore<V>;
  requestLock: NamedLock;
  during: <T>(fn: () => Promise<T>) => Promise<T>;
  exclusive: <T>(did: string, fn: () => Promise<T>) => Promise<T>;
} {
  const { store, lock } = options;
  const scopes = new AsyncLocalStorage<Scope>();

  /** Resolves once the lock is held; the lock is let go when `release` is called. A failed wait rejects. */
  function take(name: string): Promise<Held> {
    return new Promise((resolve, reject) => {
      let release = (): void => undefined;
      const released = new Promise<void>((done) => {
        release = done;
      });
      const held: Held = { name, release, ended: Promise.resolve() };
      held.ended = lock(name, async () => {
        resolve(held);
        await released;
      });
      held.ended.catch(reject);
    });
  }

  async function hold(scope: Scope, name: string): Promise<void> {
    scope.held ??= take(name);
    if ((await scope.held).name !== name) throw new Error("sign-in lock: one account per sign-in");
  }

  const tokenSets: TokenSetStore<V> = {
    get: (did, read) => store.get(did, read),
    async set(did, value) {
      const scope = scopes.getStore();
      if (scope !== undefined) await hold(scope, lockName(did));
      await store.set(did, value);
      // Only a stored replacement cancels the pending delete: a failed write leaves the old set to be deleted.
      if (scope !== undefined) scope.deleteAtEnd = null;
    },
    async del(did) {
      const scope = scopes.getStore();
      if (scope === undefined) return store.del(did);
      await hold(scope, lockName(did));
      scope.deleteAtEnd = did;
    },
  };

  async function requestLock<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> {
    const scope = scopes.getStore();
    if (scope === undefined) return lock(name, fn);
    await hold(scope, name);
    return await fn();
  }

  async function during<T>(fn: () => Promise<T>): Promise<T> {
    const scope: Scope = { held: null, deleteAtEnd: null };
    try {
      return await scopes.run(scope, fn);
    } finally {
      const held = scope.held === null ? null : await scope.held.catch(() => null);
      if (held !== null) {
        try {
          if (scope.deleteAtEnd !== null) await store.del(scope.deleteAtEnd);
        } finally {
          held.release();
          await held.ended.catch(() => undefined);
        }
      }
    }
  }

  /** Runs `fn` holding `did`'s lock for its whole run; the library's lock calls inside it reuse that lock. */
  const exclusive = <T>(did: string, fn: () => Promise<T>): Promise<T> =>
    during(async () => {
      await hold(scopes.getStore() as Scope, lockName(did));
      return fn();
    });

  return { tokenSets, requestLock, during, exclusive };
}
