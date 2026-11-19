import { describe, expect, test } from "vitest";
import { type Passes, runIndexer } from "./run.ts";

const counts = (n: number) => async () => ({ n });

describe("indexer loop", () => {
  test("run.sigterm_during_a_pass_reaches_the_pass_and_ends_the_loop", async () => {
    // The pass in hand gets the process's stop, so it can end after its current item; the loop runs no further pass.
    const stop = new AbortController();
    const ran: string[] = [];
    const passes: Passes = {
      track: (signal) =>
        new Promise((resolve) => {
          ran.push("track");
          signal.addEventListener("abort", () => resolve({ cut: 1 }), { once: true });
          stop.abort();
        }),
      backfill: async () => {
        ran.push("backfill");
        return {};
      },
      confirm: counts(0),
    };
    const runner = runIndexer({ stream: async () => undefined, passes, intervalMs: 60_000 }, stop.signal);
    await runner.done;
    expect(ran).toEqual(["track"]);
    expect(runner.health().lastPass).toEqual({ track: { cut: 1 } });
  });

  test("run.stream_starts_before_the_first_backfill_pass", async () => {
    const order: string[] = [];
    const stop = new AbortController();
    const passes: Passes = {
      track: async () => {
        order.push("track");
        return {};
      },
      backfill: async () => {
        order.push("backfill");
        stop.abort();
        return {};
      },
      confirm: counts(0),
    };
    const runner = runIndexer(
      {
        stream: async () => {
          order.push("stream");
        },
        passes,
        intervalMs: 10,
      },
      stop.signal,
    );
    await runner.done;
    expect(order).toEqual(["stream", "track", "backfill"]);
  });

  test("run.a_failing_pass_is_counted_and_the_others_still_run", async () => {
    const stop = new AbortController();
    let ticks = 0;
    const passes: Passes = {
      track: counts(1),
      backfill: async () => {
        throw new Error("database unavailable");
      },
      confirm: async () => {
        ticks += 1;
        if (ticks === 2) stop.abort();
        return { confirmed: ticks };
      },
    };
    const runner = runIndexer({ stream: () => Promise.resolve(), passes, intervalMs: 1 }, stop.signal);
    await runner.done;
    const health = runner.health();
    expect(health.passFailures).toEqual({ track: 0, backfill: 2, confirm: 0 });
    expect(health.lastPass).toEqual({ track: { n: 1 }, confirm: { confirmed: 2 } });
    expect(health.ticks).toBe(2);
  });

  test("run.stops_when_the_signal_aborts", async () => {
    const stop = new AbortController();
    const runner = runIndexer(
      {
        stream: (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve())),
        passes: { track: counts(0), backfill: counts(0), confirm: counts(0) },
        intervalMs: 60_000,
      },
      stop.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    stop.abort();
    await runner.done; // resolves despite the 60 s interval
    expect(runner.health().ticks).toBe(1);
  });

  test("run.totals_add_up_every_pass_since_start", async () => {
    const stop = new AbortController();
    let runs = 0;
    const passes: Passes = {
      track: counts(0),
      backfill: counts(0),
      confirm: async () => {
        runs += 1;
        if (runs === 3) stop.abort();
        return { confirmed: 1, failed: runs === 2 ? 0 : 2 };
      },
    };
    const runner = runIndexer({ stream: () => Promise.resolve(), passes, intervalMs: 1 }, stop.signal);
    await runner.done;
    // The last run failed 2, but 4 failed since start: a confirm pass that keeps failing shows in the total.
    expect(runner.health().totals.confirm).toEqual({ confirmed: 3, failed: 4 });
  });
});
