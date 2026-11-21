// One chat tab at a time. matrix-js-sdk 43.0.0 says two clients on one IndexedDB crypto store corrupt it, and that the
// application must make sure only one runs (initRustCrypto's warning, src/client.ts:1984-1987; README.md:345). Two tabs
// would also sign in in turn, each one's renewal ending the other's session, and overwrite each other's hop state.
// Element guards this with a session lock taken before anything starts (element-web v1.12.35
// apps/web/src/components/structures/MatrixChat.tsx:323-330): a tab that finds the lock held asks first (:503-509,
// ConfirmSessionLockTheftView, "open in another window... Continue to use it here"), and the tab whose lock is taken
// stops its client and says so (:382-392, Lifecycle.ts:117-120, SessionLockStolenView). Element builds the lock from
// localStorage pings (apps/web/src/utils/SessionLock.ts:107-287); we use the Web Locks API, which gives the same moves
// directly: a request with an abort signal waits a bounded time, steal takes the lock and rejects the holder's promise
// with an AbortError, and the browser releases a lock when its page goes (W3C Web Locks,
// https://w3c.github.io/web-locks/, read as index.bs on main 2026-11-21: options signal and steal, "abort the request",
// "Termination of Locks"). The lock is per origin (storage bucket), so every tab of the chat page meets it. Nothing is
// stored.

export const TAB_LOCK = "unset-chat";
/**
 * How long a tab waits for the lock before it counts as held elsewhere. A reload, and the hop's return to this page,
 * meet the lock of this same tab's previous page, which the browser lets go on unload through its lock task queue, so
 * not at once (W3C Web Locks "Termination of Locks"); the chat_page.renews and reload_cached_sync e2e runs met it.
 */
export const TAB_GRACE_MS = 1_000;

export type TabLock = "held" | "elsewhere" | "unavailable";

/**
 * Take this origin's chat lock and hold it for the page's life. "if_free" waits up to the grace for it and gives up
 * its place in the queue then ("elsewhere"); "take_over" takes it from the tab that holds it, which is told through its
 * own `onLost`. A browser without the API, or one that refuses the request, gets "unavailable" and must not run chat
 * (fail closed).
 */
export function holdTabLock(
  locks: LockManager | undefined,
  how: "if_free" | "take_over",
  onLost: () => void,
  { name = TAB_LOCK, graceMs = TAB_GRACE_MS }: { readonly name?: string; readonly graceMs?: number } = {},
): Promise<TabLock> {
  if (locks === undefined) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    let granted = false;
    const grace = AbortSignal.timeout(graceMs);
    const options: LockOptions = how === "take_over" ? { steal: true } : { signal: grace };
    locks
      .request(name, options, () => {
        granted = true;
        resolve("held");
        return new Promise<never>(() => undefined); // held until the page goes or another tab takes it
      })
      .catch(() => {
        if (granted) return onLost();
        resolve(how === "if_free" && grace.aborted ? "elsewhere" : "unavailable");
      });
  });
}
