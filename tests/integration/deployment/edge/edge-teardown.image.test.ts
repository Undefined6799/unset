// The edge suite's teardown (P1.11i): it stops the edge and removes the image tag it built, and neither failure hides
// the other. An image test because it reaches the build helper (scripts/test/image-rules.test.ts); the removal runs
// against the real daemon with a tag no build made, so it fails the way a real one would.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { startEdge, stopEdgeAndRemoveImage } from "./edge-container.ts";
import type { Edge } from "./edge-handle.ts";
import { registerEdgeSuite } from "./edge-suite.ts";

// One `docker rmi`, killed at the edge helper's 60 s call budget.
const TEST_MS = 120_000;

// A stand-in docker that answers a start the way a healthy edge would and refuses the removal, so stop() meets a
// `docker rm -f` that exits non-zero (P1.11s). The stub upstream listens on the loopback "gateway" it reports.
const standIn = mkdtempSync(join(tmpdir(), "edge-stop-"));
writeFileSync(
  join(standIn, "docker"),
  [
    "#!/bin/sh",
    'case "$1" in',
    "  network) echo 127.0.0.1 ;;",
    "  run) echo stand-in ;;",
    "  inspect) echo healthy ;;",
    "  port) echo 127.0.0.1:44300 ;;",
    "  exec) echo '-----BEGIN CERTIFICATE-----' ;;",
    "  rm) echo 'Error response from daemon: removal refused' >&2; exit 1 ;;",
    "esac",
    "",
  ].join("\n"),
);
chmodSync(join(standIn, "docker"), 0o755);
afterAll(() => rmSync(standIn, { recursive: true, force: true }));

/** Runs `fn` with the stand-in docker first on PATH. */
async function onStandIn<T>(fn: () => Promise<T>): Promise<T> {
  const path = process.env.PATH;
  process.env.PATH = `${standIn}${delimiter}${path}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = path;
  }
}

describe("edge teardown", () => {
  test("stop_and_removal_failures_are_both_reported", { timeout: TEST_MS }, async () => {
    const absent = `unset-test-${randomBytes(8).toString("hex")}`;
    const edge = { stop: () => Promise.reject(new Error("stop failed")) };
    const error = await stopEdgeAndRemoveImage(edge, absent).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(AggregateError);
    const [stopped, removed] = (error as AggregateError).errors as Error[];
    expect(stopped?.message).toBe("stop failed");
    expect(removed?.message).toContain(`docker rmi failed (${absent})`);
  });

  test("removal_runs_after_a_clean_stop", { timeout: TEST_MS }, async () => {
    const absent = `unset-test-${randomBytes(8).toString("hex")}`;
    let stops = 0;
    const edge = { stop: async () => void stops++ };
    await expect(stopEdgeAndRemoveImage(edge, absent)).rejects.toThrow(`docker rmi failed (${absent})`);
    expect(stops).toBe(1);
  });

  test("failed_removal_fails_the_stop", { timeout: TEST_MS }, async () => {
    // docker() returns a non-zero code without throwing, so a refused `docker rm -f` used to pass silently (P1.11s).
    const edge = await onStandIn(() => startEdge("unset-test-stand-in"));
    const failed = await onStandIn(() => edge.stop()).catch((error: unknown) => error);
    expect((failed as Error).message).toMatch(
      /^docker rm failed \(unset-edge-\d+-\d+\): Error response from daemon: removal refused$/,
    );
    // A second stop meets the refusal again and a stub that is already closed: both are reported, the removal first.
    const twice = await onStandIn(() => edge.stop()).catch((error: unknown) => error);
    expect(twice).toBeInstanceOf(AggregateError);
    const [removal, close] = (twice as AggregateError).errors as Error[];
    expect(removal?.message).toMatch(/^docker rm failed/);
    expect((close as NodeJS.ErrnoException | undefined)?.code).toBe("ERR_SERVER_NOT_RUNNING");
  });

  test("suite_after_all_stops_and_removes_the_tag", { timeout: TEST_MS }, async () => {
    // edge.image.test.ts's afterAll once only stopped the edge; it now registers through registerEdgeSuite, whose
    // afterAll also removes the tag the suite built (P1.11s, #723 verify).
    const absent = `unset-test-${randomBytes(8).toString("hex")}`;
    const hooks: { before?: () => Promise<void>; after?: () => Promise<void> } = {};
    let stops = 0;
    const edge = { stop: async () => void stops++ } as unknown as Edge;
    let started: { edge: Edge; image: string } | undefined;
    registerEdgeSuite(
      {
        beforeAll: (fn) => {
          hooks.before = fn;
        },
        afterAll: (fn) => {
          hooks.after = fn;
        },
      },
      (value) => {
        started = value;
      },
      { prepare: () => absent, start: async () => edge },
    );
    await hooks.before?.();
    expect(started).toEqual({ edge, image: absent });
    await expect(hooks.after?.()).rejects.toThrow(`docker rmi failed (${absent})`);
    expect(stops).toBe(1);
  });
});
