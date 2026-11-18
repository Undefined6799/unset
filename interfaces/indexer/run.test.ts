import { describe, expect, test } from "vitest";
import { type Passes, runIndexer } from "./run.ts";

const counts = (n: number) => async () => ({ n });

describe("indexer loop", () => {
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
});
