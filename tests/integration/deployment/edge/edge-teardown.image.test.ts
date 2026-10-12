// The edge suite's teardown (P1.11i): it stops the edge and removes the image tag it built, and neither failure hides
// the other. An image test because it reaches the build helper (scripts/test/image-rules.test.ts); the removal runs
// against the real daemon with a tag no build made, so it fails the way a real one would.
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { type Edge, stopEdgeAndRemoveImage } from "./edge-container.ts";
import { registerEdgeSuite } from "./edge-suite.ts";

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
