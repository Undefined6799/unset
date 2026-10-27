// The edge helpers' exit-code checks (P1.34g, from the #746 verify): docker() returns a non-zero code without throwing
// (tests/support/docker.ts), so each call whose failure matters checks its code, and these tests pin each check (N2,
// N5). The teardown's budget covers every docker call it can make (N3, RE-1). A stand-in docker answers the way a
// healthy edge would, logs every call, and refuses the one subcommand named in UNSET_STAND_IN_REFUSE; no docker is
// needed, but it imports the module that builds the edge image, so it is an image test (P1.28r).
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { startEdge } from "./edge-container.ts";
import { CALL_MS, outputOf } from "./edge-handle.ts";
import { registerEdgeSuite } from "./edge-suite.ts";

const standIn = mkdtempSync(join(tmpdir(), "edge-exit-"));
const calls = join(standIn, "calls.log");
writeFileSync(
  join(standIn, "docker"),
  [
    "#!/bin/sh",
    `echo "$*" >> '${calls}'`,
    'case "$1 $2" in',
    '  "$UNSET_STAND_IN_REFUSE") echo "Error response from daemon: refused $1 $2" >&2; exit 1 ;;',
    "esac",
    'case "$1" in',
    "  network) echo 127.0.0.1 ;;",
    "  run) echo stand-in ;;",
    "  inspect) echo healthy ;;",
    "  port) echo 127.0.0.1:44300 ;;",
    "  exec) echo '-----BEGIN CERTIFICATE-----' ;;",
    "esac",
    "",
  ].join("\n"),
);
chmodSync(join(standIn, "docker"), 0o755);
afterAll(() => rmSync(standIn, { recursive: true, force: true }));

/** Runs `fn` with the stand-in docker first on PATH, refusing `refuse` (`volume rm`, `rm -f`) when it is given. */
async function onStandIn<T>(fn: () => Promise<T>, refuse = ""): Promise<T> {
  const { PATH: path, UNSET_STAND_IN_REFUSE: before } = process.env;
  process.env.PATH = `${standIn}${delimiter}${path}`;
  process.env.UNSET_STAND_IN_REFUSE = refuse;
  try {
    return await fn();
  } finally {
    process.env.PATH = path;
    if (before === undefined) delete process.env.UNSET_STAND_IN_REFUSE;
    else process.env.UNSET_STAND_IN_REFUSE = before;
  }
}

/** The docker calls the stand-in logged from line `from` on. */
const loggedFrom = (from: number): string[] => readFileSync(calls, "utf8").split("\n").filter(Boolean).slice(from);
const loggedCount = (): number => {
  try {
    return loggedFrom(0).length;
  } catch {
    return 0;
  }
};

describe("edge exit-code checks", () => {
  test("refused_volume_create_fails_the_start", async () => {
    const from = loggedCount();
    const start = onStandIn(() => startEdge("unset-test-stand-in"), "volume create");
    await expect(start).rejects.toThrow(
      "docker volume create failed: Error response from daemon: refused volume create",
    );
    // The start stops at the refusal: no container is run, and the removal still runs.
    const logged = loggedFrom(from);
    expect(logged.some((line) => line.startsWith("run "))).toBe(false);
    expect(logged.some((line) => /^rm -f unset-edge-\d+-\d+$/.test(line))).toBe(true);
  });

  test("refused_volume_removal_fails_the_stop", async () => {
    const edge = await onStandIn(() => startEdge("unset-test-stand-in"));
    const failed = await onStandIn(() => edge.stop(), "volume rm").catch((error: unknown) => error);
    expect((failed as Error).message).toMatch(
      /^docker volume rm failed \(unset-edge-\d+-\d+-data\): Error response from daemon: refused volume rm$/,
    );
  });

  test("failed_command_output_is_refused", () => {
    // A find that cannot run prints nothing; read as "nothing found", the ownership test passed (N5).
    expect(() => outputOf({ code: 1, out: "", err: "find: /data: Permission denied" }, "find")).toThrow(
      "find exited 1: find: /data: Permission denied",
    );
    expect(outputOf({ code: 0, out: "/data\n", err: "" }, "find")).toBe("/data\n");
  });

  test("teardown_budget_covers_every_docker_call", async () => {
    // The suite's afterAll stops the edge and removes the tag; each docker call it makes is killed at CALL_MS, so its
    // budget must hold all of them, with room to report (N3, RE-1). Counted, not assumed: a new call fails here.
    let teardown: { fn: () => Promise<void>; timeoutMs: number } | undefined;
    let before: (() => Promise<void>) | undefined;
    registerEdgeSuite(
      {
        beforeAll: (fn) => {
          before = fn;
        },
        afterAll: (fn, timeoutMs) => {
          teardown = { fn, timeoutMs };
        },
      },
      () => undefined,
      { prepare: () => "unset-test-stand-in", start: (image) => startEdge(image) },
    );
    await onStandIn(async () => before?.());
    const from = loggedCount();
    await onStandIn(async () => teardown?.fn());
    const made = loggedFrom(from);
    expect(made).toEqual([
      expect.stringMatching(/^rm -f unset-edge-/),
      expect.stringMatching(/^volume rm -f unset-edge-/),
      "rmi unset-test-stand-in",
    ]);
    expect(made.length * CALL_MS).toBeLessThan(teardown?.timeoutMs ?? 0);
  });
});
