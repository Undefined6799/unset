// tests/support/docker.ts (P1.27k): a call that outlives its budget is killed and named, instead of blocking the
// event loop until the job's timeout. The stand-in sleeps; no docker is needed.
import { describe, expect, test } from "vitest";
import { killBefore, runOrKill } from "../support/docker.ts";

// The stand-in sleeps 10 s; the kill fires at 300 ms, well inside this test's budget.
const SLEEP_MS = 10_000;
const TEST_MS = 5_000;

describe("tests/support/docker.ts", () => {
  test("hung_call_is_killed_and_named", { timeout: TEST_MS }, () => {
    const started = Date.now();
    expect(() => runOrKill(process.execPath, ["-e", `setTimeout(() => {}, ${SLEEP_MS})`], { timeoutMs: 300 })).toThrow(
      new Error(`${process.execPath.split("/").pop()} -e killed after 300 ms`),
    );
    expect(Date.now() - started).toBeLessThan(TEST_MS);
  });

  test("finished_call_returns_its_output", () => {
    const ran = runOrKill(process.execPath, ["-e", "process.stdout.write('out'); process.exit(3)"], {
      timeoutMs: 5_000,
    });
    expect(ran).toEqual({ code: 3, out: "out", err: "" });
  });

  test("kill_budget_sits_under_the_test_budget", () => {
    expect(killBefore(120_000)).toBe(115_000);
  });
});
