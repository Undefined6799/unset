// The edge suite's teardown (P1.11i): it stops the edge and removes the image tag it built, and neither failure hides
// the other. An image test because it reaches the build helper (scripts/test/image-rules.test.ts); the removal runs
// against the real daemon with a tag no build made, so it fails the way a real one would.
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { stopEdgeAndRemoveImage } from "./edge-container.ts";

// One `docker rmi`, killed at the edge helper's 60 s call budget.
const TEST_MS = 120_000;

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
});
