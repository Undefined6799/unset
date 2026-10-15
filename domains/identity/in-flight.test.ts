// The in-flight map's sharing and write-ordering rules (P1.33r; architecture ruling
// unset-plan/book-edits/2026-10-14-outside-review-lows.md, item 2, rules a, e and f; verify-864-3048c2f B1, S1, S2).
// The resolver's tests cover the same rules through resolveDid. awaitFlight's rejection path: P1.35h.
import { describe, expect, test } from "vitest";
import { awaitFlight, createInFlight, type MayWrite } from "./in-flight.ts";
import { IdentityError } from "./resolve-did.ts";

/** A task that hands back its write check and waits until the test releases it. */
function heldTasks() {
  const started: { mayWrite: MayWrite; release: (value: string) => void }[] = [];
  const task = (mayWrite: MayWrite) => new Promise<string>((release) => started.push({ mayWrite, release }));
  return { task, started };
}

const tick = () => new Promise((settled) => setTimeout(settled, 0));

describe("createInFlight", () => {
  test("a_newer_lookup_that_wrote_blocks_an_older_one", () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTasks();
    inFlight.share("k", false, task);
    inFlight.share("k", true, task);
    expect(started[1]?.mayWrite()).toBe(true);
    expect(started[0]?.mayWrite()).toBe(false);
  });

  test("an_older_lookup_writes_when_the_newer_one_fails", () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTasks();
    inFlight.share("k", true, task);
    inFlight.share("k", true, task);
    // The newer fresh lookup failed, so it never asks to write; the older one's success must still land.
    expect(started[0]?.mayWrite()).toBe(true);
    expect(started[1]?.mayWrite()).toBe(true);
  });

  test("an_older_lookup_writes_when_the_newer_one_fails_first", async () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTasks();
    inFlight.share("k", true, task);
    const newer = inFlight.share("k", true, task);
    started[1]?.release("failed, so it never asks to write");
    await newer;
    expect(started[0]?.mayWrite()).toBe(true);
  });

  test("a_lookup_from_before_a_drop_stays_silent_after_others_end", async () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTasks();
    inFlight.share("k", false, task);
    inFlight.drop("k");
    const between = inFlight.share("k", false, task);
    started[1]?.release("done");
    await between;
    inFlight.share("k", false, task); // the DID's order must have outlived the lookup that ended
    expect(started[0]?.mayWrite()).toBe(false);
    expect(started[2]?.mayWrite()).toBe(true);
  });

  test("a_task_that_throws_at_once_rejects_its_flight", async () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTasks();
    const thrown = inFlight.share("k", false, () => {
      throw new Error("bad input");
    });
    await expect(thrown).rejects.toThrow("bad input");
    inFlight.share("k", false, task);
    expect(started).toHaveLength(1); // a new flight: the failed one left the map
  });

  test("drop_starts_a_new_flight_and_silences_the_old_one", async () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTasks();
    const before = inFlight.share("k", false, task);
    expect(inFlight.share("k", false, task)).toBe(before);
    inFlight.drop("k");
    const after = inFlight.share("k", false, task);
    expect(started).toHaveLength(2);
    expect(started.map((s) => s.mayWrite())).toEqual([false, true]);
    started[0]?.release("old");
    started[1]?.release("new");
    expect([await before, await after]).toEqual(["old", "new"]);
  });

  test("a_fresh_call_orders_against_an_unshared_lookup_for_the_same_did", () => {
    const inFlight = createInFlight<string, string>(1);
    const { task, started } = heldTasks();
    inFlight.share("a", false, task); // fills the map
    inFlight.share("b", false, task); // unshared
    inFlight.share("b", true, task); // unshared too, and started later
    expect(started[2]?.mayWrite()).toBe(true);
    expect(started[1]?.mayWrite()).toBe(false);
  });

  test("a_fresh_call_for_one_did_leaves_unshared_lookups_for_others_alone", () => {
    const inFlight = createInFlight<string, string>(1);
    const { task, started } = heldTasks();
    inFlight.share("a", false, task); // fills the map
    inFlight.share("b", false, task); // unshared
    inFlight.share("a", true, task);
    inFlight.drop("a");
    expect(started[1]?.mayWrite()).toBe(true);
  });

  test("a_fresh_call_takes_over_its_did_when_the_map_is_full", () => {
    const inFlight = createInFlight<string, string>(1);
    const { task } = heldTasks();
    inFlight.share("a", false, task);
    const fresh = inFlight.share("a", true, task);
    expect(inFlight.share("a", false, task)).toBe(fresh);
  });

  test("an_older_flight_finishing_keeps_the_newer_entry", async () => {
    const inFlight = createInFlight<string, string>(10);
    const { task, started } = heldTasks();
    const older = inFlight.share("k", false, task);
    const fresh = inFlight.share("k", true, task);
    started[0]?.release("old");
    await older;
    expect(inFlight.share("k", false, task)).toBe(fresh);
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
      await tick();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});

describe("awaitFlight", () => {
  test("a_settled_flight_stops_listening_for_the_abort", async () => {
    const controller = new AbortController();
    let abortedCalls = 0;
    const outcome = await awaitFlight(Promise.resolve("done"), controller.signal, () => {
      abortedCalls += 1;
      return "aborted";
    });
    await tick();
    controller.abort();
    expect([outcome, abortedCalls]).toEqual(["done", 0]);
  });

  test("a_rejecting_flight_rejects_a_caller_with_a_live_signal", async () => {
    const controller = new AbortController();
    const flight = Promise.reject(new IdentityError("not_found"));
    const waiting = awaitFlight(flight, controller.signal, () => "aborted").then(
      () => "resolved",
      (error: unknown) => error,
    );
    // The signal never fires: the rejection alone must settle the caller, before the next timer.
    const outcome = await Promise.race([waiting, tick().then(() => "still waiting")]);
    expect(outcome).toBeInstanceOf(IdentityError);
    expect((outcome as IdentityError).kind).toBe("not_found");
  });

  test("a_rejected_flight_stops_listening_for_the_abort", async () => {
    const controller = new AbortController();
    let abortedCalls = 0;
    const flight = Promise.reject(new IdentityError("invalid_doc"));
    await expect(
      awaitFlight(flight, controller.signal, () => {
        abortedCalls += 1;
        return "aborted";
      }),
    ).rejects.toMatchObject({ kind: "invalid_doc" });
    await tick();
    controller.abort();
    expect(abortedCalls).toBe(0);
  });
});
