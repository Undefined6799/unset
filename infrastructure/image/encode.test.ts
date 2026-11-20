import { describe, expect, test } from "vitest";
import { qualitySteps } from "./encode.ts";

describe("encode.quality_steps", () => {
  test("steps down by 10 and always ends on the configured minimum", () => {
    expect(qualitySteps(75, 30)).toEqual([75, 65, 55, 45, 35, 30]);
    expect(qualitySteps(85, 45)).toEqual([85, 75, 65, 55, 45]);
    expect(qualitySteps(50, 50)).toEqual([50]);
  });
});
