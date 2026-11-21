// One chat tab at a time (Element's session lock, our way: tab-lock.ts). These run against Node's own LockManager
// (navigator.locks, added in Node v24.5.0, doc/api/globals.md), which follows the browser API's semantics; each call
// below stands for one tab of the same origin. No double: it is the real lock implementation.
import { describe, expect, test } from "vitest";
import { announceHop, holdTabLock, TAB_LOCK } from "./tab-lock.ts";

let n = 0;
/** A lock name of its own per test, since a held lock is never released while the "page" lives. */
const fresh = () => `${TAB_LOCK}:test-${++n}`;
/** A tab that is never told anything. */
const unheard = (): void => undefined;
const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("holdTabLock", () => {
  test("chat.tab_first: the first tab holds the lock", async () => {
    const name = fresh();
    expect(await holdTabLock(navigator.locks, "if_free", unheard, { name, graceMs: 50 })).toBe("held");
  });

  test("chat.tab_second_waits: a second tab is told chat is open elsewhere, and takes nothing", async () => {
    const name = fresh();
    let firstLost = false;
    await holdTabLock(navigator.locks, "if_free", () => (firstLost = true), { name });
    expect(await holdTabLock(navigator.locks, "if_free", unheard, { name, graceMs: 50 })).toBe("elsewhere");
    await nextTurn();
    expect(firstLost).toBe(false);
    const { held } = await navigator.locks.query();
    expect(held?.filter((l) => l.name === name)).toHaveLength(1);
  });

  test("chat.tab_take_over: using chat here takes the lock, and the first tab is told it lost it", async () => {
    const name = fresh();
    let firstLost = 0;
    let secondLost = 0;
    await holdTabLock(navigator.locks, "if_free", () => firstLost++, { name, graceMs: 50 });
    expect(await holdTabLock(navigator.locks, "take_over", () => secondLost++, { name })).toBe("held");
    await nextTurn();
    expect(firstLost).toBe(1);
    expect(secondLost).toBe(0);
    // A third tab now meets the second one's lock.
    expect(await holdTabLock(navigator.locks, "if_free", unheard, { name, graceMs: 50 })).toBe("elsewhere");
  });

  test("chat.tab_take_back: the first tab can take chat back, and the second is told", async () => {
    const name = fresh();
    let firstLost = 0;
    let secondLost = 0;
    await holdTabLock(navigator.locks, "if_free", () => firstLost++, { name, graceMs: 50 });
    await holdTabLock(navigator.locks, "take_over", () => secondLost++, { name });
    expect(await holdTabLock(navigator.locks, "take_over", () => firstLost++, { name, graceMs: 50 })).toBe("held");
    await nextTurn();
    expect(firstLost).toBe(1);
    expect(secondLost).toBe(1);
  });

  test("chat.tab_reload: a lock let go within the grace, as a reloading or hopping tab's old page does, is taken", async () => {
    const name = fresh();
    let letGo: () => void = unheard;
    void navigator.locks.request(name, () => new Promise<void>((resolve) => (letGo = resolve)));
    await nextTurn();
    const taking = holdTabLock(navigator.locks, "if_free", unheard, { name, graceMs: 1_000 });
    setTimeout(() => letGo(), 50);
    expect(await taking).toBe("held");
  });

  test("chat.tab_grace_ends: a lock still held after the grace means another tab, and the waiter never holds it", async () => {
    const name = fresh();
    let letGo: () => void = unheard;
    void navigator.locks.request(name, () => new Promise<void>((resolve) => (letGo = resolve)));
    await nextTurn();
    expect(await holdTabLock(navigator.locks, "if_free", unheard, { name, graceMs: 50 })).toBe("elsewhere");
    // The tab that gave up does not take the lock when it frees later, so the next tab to ask gets it.
    letGo();
    await nextTurn();
    expect(await holdTabLock(navigator.locks, "if_free", unheard, { name, graceMs: 50 })).toBe("held");
  });

  test("chat.tab_no_locks: a browser without the lock API does not run chat (fail closed)", async () => {
    expect(await holdTabLock(undefined, "if_free", unheard, { name: fresh() })).toBe("unavailable");
  });

  test("chat.tabs_restored_together: two tabs restored at once, the first hopping inside the second's grace, hop once", async () => {
    // A browser restoring two chat tabs starts both pages together. The first takes the lock and leaves for the sign-in
    // hop, which lets the lock go (its page goes) inside the second's grace. Were the second to take it and hop too,
    // the two hops would share the one __Host-chat-state cookie: the first tab's return would redeem against the second
    // one's state (chat.state_mismatch, an error card) and the second's would meet that card's lock (open elsewhere),
    // leaving chat open nowhere. So at most one tab hops, and neither ends on an error card.
    const name = fresh();
    const channel = `${name}:hop`;
    const graceMs = 400;
    let hops = 0;
    /** One tab's page, started as boot() starts it: hold the lock, then hop unless this is the hop's return. */
    const start = async (returning: boolean) => {
      const tab = page();
      const hopsHeard = new BroadcastChannel(channel);
      const outcome = await holdTabLock(tab.locks, "if_free", unheard, { name, graceMs, hops: hopsHeard });
      if (outcome === "held" && !returning) {
        hops++;
        announceHop(hopsHeard);
        await nextTurn();
        tab.leave(); // the navigation to the hop ends this page, and with it its lock
      }
      if (outcome !== "held" || !returning) hopsHeard.close();
      return outcome;
    };
    const [first, second] = await Promise.all([start(false), start(false)]);
    expect(hops).toBe(1);
    expect(first).toBe("held");
    // The second tab shows "open in another tab", with Use here: a live choice, never an error.
    expect(second).toBe("elsewhere");
    // The first tab's return finds the lock free and signs in.
    expect(await start(true)).toBe("held");
    expect(hops).toBe(1);
  });
});

/** One page of a tab. Its locks go when the page goes, as the browser lets a page's locks go (W3C Web Locks,
 * "Termination of Locks"); `leave` is that navigation. Everything else is Node's real LockManager. */
function page(): { locks: LockManager; leave: () => void } {
  let leave: () => void = unheard;
  const left = new Promise<void>((resolve) => (leave = resolve));
  const locks = {
    request: (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) =>
      navigator.locks.request(name, options, (lock) => Promise.race([callback(lock), left])),
    query: () => navigator.locks.query(),
  } as LockManager;
  return { locks, leave };
}
