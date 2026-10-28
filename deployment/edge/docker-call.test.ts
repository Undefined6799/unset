// P1.27h (N2, N4): the edge image tests' docker helper, with a stand-in for docker and no daemon. A call that outlives
// its budget is killed and named by its subcommand, never by the image or another reference.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { BUILD_CALL_MS, buildTestBudget, CALL_MS, removalBudget, runOrKill, subcommand } from "./docker-call.ts";

const dir = mkdtempSync(join(tmpdir(), "edge-docker-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** An executable named `docker` that runs `code` with this Node, so the kill message names docker as a real call would. */
function standIn(code: string): string {
  const file = join(dir, "docker");
  writeFileSync(file, `#!${process.execPath}\n${code}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("edge test docker calls", () => {
  test("subcommand_names_the_subcommand_never_the_image", () => {
    expect(subcommand(["run", "busybox"])).toBe("run");
    expect(subcommand(["run", "--rm", "--entrypoint", "cat", "busybox", "/etc/caddy/Caddyfile"])).toBe("run");
    expect(subcommand(["rmi", "unset-test-abcdef"])).toBe("rmi");
    expect(subcommand(["create", "--name", "unset-test-abcdef", "busybox"])).toBe("create");
    expect(subcommand(["image", "inspect", "busybox"])).toBe("image inspect");
    expect(subcommand(["--version"])).toBe("");
  });

  test("a_stand_in_that_outlives_its_budget_is_killed_and_named", () => {
    // It ignores SIGTERM and would sleep 20 s; SIGKILL at 300 ms stops it, and the failure names `docker run`.
    const docker = standIn("process.on('SIGTERM', () => {}); setTimeout(() => {}, 20_000);");
    const started = Date.now();
    expect(() => runOrKill(spawnSync, docker, ["run", "busybox", "sleep", "20"], 300)).toThrow(
      new Error("docker run killed after 300 ms"),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("a_call_inside_its_budget_returns_what_it_printed", () => {
    const docker = standIn("process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 3;");
    expect(runOrKill(spawnSync, docker, ["rmi", "unset-test-abcdef"], 5_000)).toEqual({
      code: 3,
      out: "out",
      err: "err",
    });
  });

  test("a_budget_must_be_positive", () => {
    // spawnSync reads a zero timeout as none at all (Node 26 child_process docs), so the call would never be killed.
    const docker = standIn("");
    expect(() => runOrKill(spawnSync, docker, ["run", "busybox"], 0)).toThrow(RangeError);
    expect(() => runOrKill(spawnSync, docker, ["run", "busybox"], -1)).toThrow(RangeError);
  });

  test("call_budgets_sum_below_their_test_budget", () => {
    // N1: a build and its calls are killed before the test's budget ends, and no budget reaches run.ts's 600 s.
    for (const calls of [0, 1, 2, 3, 4, 5]) {
      expect(BUILD_CALL_MS + calls * CALL_MS, `${calls} calls`).toBeLessThan(buildTestBudget(calls));
      expect(buildTestBudget(calls), `${calls} calls`).toBeLessThan(600_000);
    }
    expect(() => buildTestBudget(6)).toThrow(RangeError);
    // A hook's removals, each killed at CALL_MS, fit inside its budget.
    expect(4 * CALL_MS).toBeLessThan(removalBudget(4));
  });
});
