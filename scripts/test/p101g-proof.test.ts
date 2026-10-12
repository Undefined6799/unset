// P1.01g proof only: a deliberately failing test on a throwaway branch that is never merged.
import { describe, expect, test } from "vitest";

describe("p101g proof", () => {
  test("p101g_deliberate_failure", () => {
    expect(1 + 1).toBe(3);
  });
});
