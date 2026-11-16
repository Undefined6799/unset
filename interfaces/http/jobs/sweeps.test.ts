// P2.03s (sweeps.ts): web's expiry sweeps run once at start and then on a timer, a failing sweep neither stops the
// others nor the timer, and a run still going is never joined by a second. The sweeps are doubles of Postgres
// (unmanaged here); tests/integration covers the real DELETEs.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { startSweeps } from "./sweeps.ts";

const HOUR = 3_600_000;

function recorder() {
  const lines: { event: string; fields: unknown }[] = [];
  const log = { error: (event: string, fields: unknown) => void lines.push({ event, fields }) };
  return { lines, log: log as unknown as Parameters<typeof startSweeps>[0]["log"] };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("startSweeps", () => {
  test("runs_at_start_and_every_interval", async () => {
    const ran: string[] = [];
    const { log } = recorder();
    const sweeps = [
      { job: "sweep.session", run: async () => void ran.push("session") },
      { job: "sweep.oauth_state", run: async () => void ran.push("state") },
    ];
    const stop = startSweeps({ sweeps, everyMs: HOUR, log });
    await vi.advanceTimersByTimeAsync(0);
    expect(ran).toEqual(["session", "state"]);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(ran).toEqual(["session", "state", "session", "state"]);
    stop();
  });

  test("a_failing_sweep_is_logged_and_stops_nothing", async () => {
    const ran: string[] = [];
    const { lines, log } = recorder();
    class QueryFailed extends Error {}
    const sweeps = [
      {
        job: "sweep.session",
        run: async () => {
          throw new QueryFailed("did:plc:secret in a message");
        },
      },
      { job: "sweep.oauth_state", run: async () => void ran.push("state") },
    ];
    const stop = startSweeps({ sweeps, everyMs: HOUR, log });
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(ran).toEqual(["state", "state"]);
    // The class name only: an error message can carry a DID (SE-7).
    expect(lines).toEqual([
      { event: "error", fields: { job: "sweep.session", kind: "QueryFailed" } },
      { event: "error", fields: { job: "sweep.session", kind: "QueryFailed" } },
    ]);
    stop();
  });

  test("a_run_still_going_is_not_joined_by_a_second", async () => {
    let started = 0;
    let release = (): void => undefined;
    const { log } = recorder();
    const slow = {
      job: "sweep.session",
      run: () => {
        started += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const stop = startSweeps({ sweeps: [slow], everyMs: HOUR, log });
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(started).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(started).toBe(2);
    stop();
  });

  test("stop_ends_the_timer", async () => {
    let runs = 0;
    const { log } = recorder();
    const stop = startSweeps({
      sweeps: [
        {
          job: "sweep.session",
          run: async () => {
            runs += 1;
          },
        },
      ],
      everyMs: HOUR,
      log,
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(runs).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
