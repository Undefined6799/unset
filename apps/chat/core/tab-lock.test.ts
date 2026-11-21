// One chat tab at a time (Element's session lock, our way: tab-lock.ts). These run against Node's own LockManager
// (navigator.locks, added in Node v24.5.0, doc/api/globals.md), which follows the browser API's semantics; each call
// below stands for one tab of the same origin. No double: it is the real lock implementation.
import { describe, expect, test } from "vitest";
import { holdTabLock, TAB_LOCK } from "./tab-lock.ts";

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
});
