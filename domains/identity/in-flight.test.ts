// The in-flight map's ownership rules (P1.33r; architecture ruling
// unset-plan/book-edits/2026-10-14-outside-review-lows.md, item 2, rule f). The resolver's tests cover sharing itself.
import { describe, expect, test } from "vitest";
import { createInFlight, type StillCurrent } from "./in-flight.ts";

/** A task that hands back its ownership check and waits until the test releases it. */
function heldTask() {
  const started: { stillCurrent: StillCurrent; release: (value: string) => void }[] = [];
  const task = (stillCurrent: StillCurrent) =>
    new Promise<string>((release) => started.push({ stillCurrent, release }));
  return { task, started };
}

describe("createInFlight", () => {
  test("drop_starts_a_new_flight_and_silences_the_old_one", async () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTask();
    const before = inFlight.share("k", false, task);
    expect(inFlight.share("k", false, task)).toBe(before);
    inFlight.drop("k");
    const after = inFlight.share("k", false, task);
    expect(started).toHaveLength(2);
    expect(started.map((s) => s.stillCurrent())).toEqual([false, true]);
    started[0]?.release("old");
    started[1]?.release("new");
    expect([await before, await after]).toEqual(["old", "new"]);
  });

  test("a_task_the_full_map_left_unshared_loses_ownership_on_drop_or_fresh", () => {
    const inFlight = createInFlight<string, string>(1);
    const { task, started } = heldTask();
    inFlight.share("a", false, task);
    inFlight.share("b", false, task); // the map is full: b runs alone
    inFlight.share("c", false, task);
    expect(started.map((s) => s.stillCurrent())).toEqual([true, true, true]);
    inFlight.drop("b");
    expect(started[1]?.stillCurrent()).toBe(false);
    inFlight.share("c", true, task); // a fresh call for c supersedes c's unshared task
    expect(started[2]?.stillCurrent()).toBe(false);
  });

  test("a_flight_whose_callers_all_left_is_not_an_unhandled_rejection", async () => {
    const inFlight = createInFlight<string, string>(10);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      void inFlight.share("k", false, async () => {
        throw new Error("network");
      });
      await new Promise((settled) => setTimeout(settled, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});
