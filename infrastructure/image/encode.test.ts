import { describe, expect, test } from "vitest";
import { attempts, qualitySteps } from "./encode.ts";

describe("encode.quality_steps", () => {
  test("steps down by 10 and always ends on the configured minimum", () => {
    expect(qualitySteps(75, 30)).toEqual([75, 65, 55, 45, 35, 30]);
    expect(qualitySteps(85, 45)).toEqual([85, 75, 65, 55, 45]);
    expect(qualitySteps(50, 50)).toEqual([50]);
  });
});

describe("encode.attempts (ADR 0088)", () => {
  const MAIN = {
    name: "main",
    format: "webp",
    fit: "inside",
    size: 4096,
    quality: 90,
    minQuality: 75,
    maxBytes: 5_000_000,
    required: true,
    smaller: [
      { size: 3072, minQuality: 75 },
      { size: 2560, minQuality: 45 },
    ],
    losslessFrom: ["png"],
  } as const;

  const jpeg = { format: "jpeg", bytes: 10_000_000 } as const;
  const png = (bytes: number) => ({ format: "png", bytes }) as const;

  test("each size from its first quality down to its own minimum, the largest size first", () => {
    expect(attempts(MAIN, jpeg)).toEqual([
      ...[90, 80, 75].map((quality) => ({ size: 4096, quality })),
      ...[90, 80, 75].map((quality) => ({ size: 3072, quality })),
      ...[90, 80, 70, 60, 50, 45].map((quality) => ({ size: 2560, quality })),
    ]);
  });

  test("a PNG within the cap is tried lossless at the full size first; a larger PNG or another source never is", () => {
    expect(attempts(MAIN, png(5_000_000))[0]).toEqual({ size: 4096, lossless: true });
    expect(attempts(MAIN, png(5_000_000)).slice(1)).toEqual(attempts(MAIN, jpeg));
    expect(attempts(MAIN, png(5_000_001))).toEqual(attempts(MAIN, jpeg));
    expect(attempts(MAIN, { format: "webp", bytes: 1000 })).toEqual(attempts(MAIN, jpeg));
  });

  test("a version with no smaller sizes keeps the quality steps alone", () => {
    const { smaller: _s, losslessFrom: _l, ...plain } = MAIN;
    const display = { ...plain, size: 960, quality: 75, minQuality: 30 };
    expect(attempts(display, png(1000)).map((step) => ("quality" in step ? step.quality : 0))).toEqual(
      qualitySteps(75, 30),
    );
  });
});
