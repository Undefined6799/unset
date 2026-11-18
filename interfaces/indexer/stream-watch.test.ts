import { describe, expect, test } from "vitest";
import { streamWatch } from "./stream-watch.ts";

const MAX = 60_000;
const UNHEALTHY = 300_000;

function watch() {
  let clock = 1_000_000;
  const w = streamWatch({ maxRestartDelayMs: MAX, unhealthyAfterMs: UNHEALTHY, now: () => clock });
  return { w, tick: (ms: number) => (clock += ms) };
}

describe("stream watch", () => {
  test("stream.stops_that_keep_coming_turn_unhealthy", () => {
    const { w, tick } = watch();
    for (let i = 0; i < 6; i += 1) {
      w.stopped();
      tick(MAX);
    }
    expect(w.failingForMs()).toBe(6 * MAX);
    expect(w.healthy()).toBe(false);
  });

  test("stream.a_frame_applied_ends_the_streak", () => {
    const { w, tick } = watch();
    for (let i = 0; i <= UNHEALTHY / MAX + 1; i += 1) {
      w.stopped();
      tick(MAX);
    }
    expect(w.healthy()).toBe(false);
    w.applied();
    expect(w.failingForMs()).toBeNull();
    expect(w.healthy()).toBe(true);
  });

  test("stream.a_quiet_pds_after_one_stop_is_healthy", () => {
    // One stop, a dial that held, then hours with no frame: not a fault.
    const { w, tick } = watch();
    w.stopped();
    tick(2 * MAX + 1);
    expect(w.failingForMs()).toBeNull();
    tick(10 * UNHEALTHY);
    expect(w.healthy()).toBe(true);
    w.stopped(); // a later stop starts a new streak, not the old one
    expect(w.failingForMs()).toBe(0);
  });

  test("stream.no_stop_is_healthy", () => {
    expect(watch().w.healthy()).toBe(true);
  });
});
