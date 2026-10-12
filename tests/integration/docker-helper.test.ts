// tests/support/docker.ts (P1.27k, P1.27g): a call that outlives its budget is killed with SIGKILL and named, instead
// of blocking the event loop until the run's own limit. The stand-ins sleep; no docker is needed.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { killBefore, runOrKill, withCleanup } from "../support/docker.ts";

// The stand-ins sleep 10 s; the kill fires at 300 ms, well inside this test's budget.
const SLEEP_MS = 10_000;
const TEST_MS = 5_000;
const dir = mkdtempSync(join(tmpdir(), "docker-helper-"));
// A stand-in docker that sleeps whatever its arguments; `exec` makes the sleep the killed process itself.
const FAKE_DOCKER = join(dir, "docker");
writeFileSync(FAKE_DOCKER, `#!/bin/sh\nexec sleep ${SLEEP_MS / 1000}\n`);
chmodSync(FAKE_DOCKER, 0o755);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("tests/support/docker.ts", () => {
  test("hung_call_is_killed_and_named", { timeout: TEST_MS }, () => {
    const started = Date.now();
    const args = ["image", "inspect", "node:26@sha256:abc", "--format", "{{.Id}}"];
    // The message names the subcommand in full, never a flag or a reference (N9).
    expect(() => runOrKill(FAKE_DOCKER, args, { timeoutMs: 300 })).toThrow(
      new Error("docker image inspect killed after 300 ms"),
    );
    // A plain command's operand is a reference, not part of the subcommand (verifier N2 on #686).
    expect(() => runOrKill(FAKE_DOCKER, ["run", "busybox", "true"], { timeoutMs: 300 })).toThrow(
      new Error("docker run killed after 300 ms"),
    );
    expect(Date.now() - started).toBeLessThan(TEST_MS);
  });

  test("call_ignoring_sigterm_is_still_killed", { timeout: TEST_MS }, () => {
    // The docker CLI forwards SIGTERM to the daemon and waits, so only SIGKILL ends a hung call promptly (N4).
    const started = Date.now();
    const ignoresTerm = `process.on("SIGTERM", () => {}); setTimeout(() => {}, ${SLEEP_MS})`;
    expect(() => runOrKill(process.execPath, ["-e", ignoresTerm], { timeoutMs: 300 })).toThrow(/killed after 300 ms/);
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

  test("no_budget_disables_the_kill", () => {
    // A zero timeout means no timeout to spawnSync, and a negative one throws inside it (N7).
    for (const budget of [5_000, 4_000, 0, -1]) expect(() => killBefore(budget), String(budget)).toThrow(RangeError);
    for (const timeoutMs of [0, -1, Number.NaN]) {
      expect(() => runOrKill(process.execPath, ["-e", ""], { timeoutMs }), String(timeoutMs)).toThrow(RangeError);
    }
  });

  test("cleanup_failure_keeps_the_body_failure", () => {
    // A failing removal in `finally` used to replace the test's own failure (N5).
    const failing = () =>
      withCleanup(
        () => {
          throw new Error("body failed");
        },
        () => {
          throw new Error("cleanup failed");
        },
      );
    expect(failing).toThrow("body failed");
    expect(failing).toThrow("cleanup also failed: cleanup failed");
    // A body that passes still reports a failing cleanup, and a passing cleanup leaves the body's result.
    expect(() =>
      withCleanup(
        () => 1,
        () => {
          throw new Error("cleanup failed");
        },
      ),
    ).toThrow("cleanup failed");
    let cleaned = false;
    expect(
      withCleanup(
        () => 2,
        () => {
          cleaned = true;
        },
      ),
    ).toBe(2);
    expect(cleaned).toBe(true);
  });
});
