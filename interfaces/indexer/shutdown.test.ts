import { describe, expect, test } from "vitest";
import { stopWithin } from "./shutdown.ts";

describe("indexer stop", () => {
  test("shutdown.finished_steps_exit_0", async () => {
    expect(await stopWithin([Promise.resolve(), Promise.resolve()], 1000)).toBe(0);
  });

  test("shutdown.a_step_that_outlasts_the_grace_exits_1_on_time", async () => {
    const started = performance.now();
    expect(await stopWithin([new Promise<void>(() => undefined)], 50)).toBe(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("shutdown.a_failed_step_exits_1", async () => {
    expect(await stopWithin([Promise.reject(new Error("pool end failed"))], 1000)).toBe(1);
  });
});
