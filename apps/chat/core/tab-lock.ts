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

/** The message a tab sends on `HOP_CHANNEL` as it leaves for the sign-in hop it comes back from. */
const HOP = "hop";
/** The channel tabs of the chat origin tell each other on that they leave for the hop (HTML "Broadcasting"). */
export const HOP_CHANNEL = "unset-chat:hop";

/**
 * Take this origin's chat lock and hold it for the page's life. "if_free" waits up to the grace for it and gives up
 * its place in the queue then ("elsewhere"); "take_over" takes it from the tab that holds it, which is told through its
 * own `onLost`. A browser without the API, or one that refuses the request, gets "unavailable" and must not run chat
 * (fail closed).
 *
 * A lock let go inside the grace is a reload's or a hop's old page in this tab, or another tab leaving for its hop,
 * which comes straight back for the lock. Two tabs restored at once meet the second way: had the waiter taken the lock
 * and hopped too, the two hops would share the one hop-state cookie and neither tab would end signed in. So a waiter
 * that hears a hop on `hops` (announceHop) while it waits, or by the next task after it is granted the lock, counts the
 * lock as held elsewhere and lets it go at once. That the message reaches the waiter before the lock does is
 * unverified: the HTML Living Standard's "Broadcasting to other browsing contexts" (postMessage queues a task for each
 * other channel when called, so before the hopping page goes) could not be read from here (the spec host is blocked),
 * and no browser test runs this yet; the extra task is margin for the two arriving on different task queues.
 */
export function holdTabLock(
  locks: LockManager | undefined,
  how: "if_free" | "take_over",
  onLost: () => void,
  {
    name = TAB_LOCK,
    graceMs = TAB_GRACE_MS,
    hops,
  }: { readonly name?: string; readonly graceMs?: number; readonly hops?: BroadcastChannel } = {},
): Promise<TabLock> {
  if (locks === undefined) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    let granted = false;
    let hopHeard = false;
    const gaveUp = new AbortController();
    const heard = (event: MessageEvent) => {
      if (event.data !== HOP) return;
      hopHeard = true;
      gaveUp.abort();
    };
    if (how === "if_free") hops?.addEventListener("message", heard);
    const stopListening = () => hops?.removeEventListener("message", heard);
    const grace = AbortSignal.any([AbortSignal.timeout(graceMs), gaveUp.signal]);
    const options: LockOptions = how === "take_over" ? { steal: true } : { signal: grace };
    locks
      .request(name, options, async () => {
        if (how === "if_free") await new Promise((next) => setTimeout(next, 0));
        stopListening();
        if (hopHeard) return resolve("elsewhere"); // let go at once: the hopping tab comes back for it
        granted = true;
        resolve("held");
        return new Promise<never>(() => undefined); // held until the page goes or another tab takes it
      })
      .catch(() => {
        stopListening();
        if (granted) return onLost();
        resolve(how === "if_free" && grace.aborted ? "elsewhere" : "unavailable");
      });
  });
}

/** Tell the other chat tabs this one leaves for the sign-in hop, just before it goes (holdTabLock's `hops`). */
export function announceHop(channel: BroadcastChannel | undefined): void {
  channel?.postMessage(HOP);
}
