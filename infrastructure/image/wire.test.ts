// Both sides of the wire refuse what they did not ask for (ADR 0070 point 2.2): review a job past its ceiling, web a
// frame a taken-over child could have bent.
import { createHash } from "node:crypto";
import type { ImageVersion, VersionSpec } from "@unset/domains-content";
import { describe, expect, test } from "vitest";
import { decodeFrame, encodeFrame, encodeJob, type Job, parseJob, parseRefusal } from "./wire.ts";

const spec = (name: string, required: boolean, maxBytes = 1000): VersionSpec => ({
  name,
  format: "jpeg",
  fit: "inside",
  size: 100,
  quality: 80,
  minQuality: 40,
  maxBytes,
  required,
});
const job: Job = {
  limits: { maxBytes: 1_000_000, maxPixels: 1_000_000, maxEdge: 1000 },
  versions: [spec("main", true), spec("small", false)],
};
const version = (name: string, text: string): ImageVersion => {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    format: "jpeg",
    width: 10,
    height: 5,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const ok = (versions: ImageVersion[]) =>
  encodeFrame({ kind: "ok", source: { format: "png", width: 20, height: 10 }, versions });

describe("job", () => {
  test("round-trips, and only within the ceiling", () => {
    expect(parseJob(encodeJob(job))).toEqual(job);
    // ADR 0076: a 64 MiB, 120-megapixel job is the ceiling; one byte or one pixel past it is refused.
    const top = { ...job, limits: { ...job.limits, maxBytes: 64 * 1024 * 1024, maxPixels: 120_000_000 } };
    expect(parseJob(encodeJob(top))).toEqual(top);
    const big = { ...job, limits: { ...job.limits, maxBytes: 64 * 1024 * 1024 + 1 } };
    expect(parseJob(encodeJob(big))).toBeNull();
    const wide = { ...job, limits: { ...job.limits, maxPixels: 120_000_001 } };
    expect(parseJob(encodeJob(wide))).toBeNull();
    const many = { ...job, versions: Array.from({ length: 13 }, (_, i) => spec(`v${i}`, false)) };
    expect(parseJob(encodeJob(many))).toBeNull();
    const huge = { ...job, versions: [{ ...spec("main", true), size: 10_000 }] };
    expect(parseJob(encodeJob(huge))).toBeNull();
  });

  test("refuses malformed headers, bad names, duplicates and a crop off a square", () => {
    expect(parseJob(undefined)).toBeNull();
    expect(parseJob("not base64 json")).toBeNull();
    expect(parseJob(encodeJob({ ...job, versions: [spec("../x", true)] }))).toBeNull();
    expect(parseJob(encodeJob({ ...job, versions: [spec("main", true), spec("main", false)] }))).toBeNull();
    const crop = { ...spec("main", true), crop: { left: 0, top: 0, size: 10 } };
    expect(parseJob(encodeJob({ ...job, versions: [crop] }))).toBeNull();
    expect(parseJob(encodeJob({ ...job, versions: [{ ...crop, fit: "square" }] }))?.versions[0]?.crop).toEqual(
      crop.crop,
    );
  });
});

describe("job, ADR 0088", () => {
  const main: VersionSpec = {
    ...spec("main", true, 5_000_000),
    format: "webp",
    size: 4096,
    quality: 90,
    minQuality: 75,
    smaller: [
      { size: 3072, minQuality: 75 },
      { size: 2560, minQuality: 45 },
    ],
    losslessFrom: ["png"],
  };
  const withMain = (v: VersionSpec): Job => ({ ...job, versions: [v] });

  test("the 4,096 px, 5,000,000-byte main version with its smaller sizes and lossless PNG round-trips", () => {
    expect(parseJob(encodeJob(withMain(main)))).toEqual(withMain(main));
    expect(parseJob(encodeJob(withMain({ ...main, maxBytes: 5_000_001 })))).toBeNull();
  });

  test("refuses smaller sizes that do not shrink, sit out of range, are too many, or ask a quality above the first", () => {
    const bad: NonNullable<VersionSpec["smaller"]>[] = [
      [{ size: 4096, minQuality: 75 }],
      [
        { size: 2560, minQuality: 75 },
        { size: 3072, minQuality: 45 },
      ],
      [{ size: 8, minQuality: 45 }],
      [{ size: 2560, minQuality: 95 }],
      [{ size: 2560, minQuality: 0 }],
      [3000, 2900, 2800, 2700, 2600].map((size) => ({ size, minQuality: 45 })),
    ];
    for (const smaller of bad) expect(parseJob(encodeJob(withMain({ ...main, smaller })))).toBeNull();
  });

  test("refuses lossless sources that are not formats we read, and lossless on anything but WebP", () => {
    const unknown = { ...main, losslessFrom: ["gif"] } as unknown as VersionSpec;
    expect(parseJob(encodeJob(withMain(unknown)))).toBeNull();
    expect(parseJob(encodeJob(withMain({ ...main, format: "jpeg" })))).toBeNull();
  });
});

describe("frame", () => {
  test("round-trips the versions with their bytes", () => {
    const decoded = decodeFrame(ok([version("main", "aaaa"), version("small", "bb")]), job);
    expect(decoded?.versions.map((v) => [v.name, new TextDecoder().decode(v.bytes)])).toEqual([
      ["main", "aaaa"],
      ["small", "bb"],
    ]);
    expect(decoded?.source).toEqual({ format: "png", width: 20, height: 10 });
  });

  test("refuses bytes that do not match their hash", () => {
    const frame = ok([version("main", "aaaa")]);
    frame[frame.length - 1] = 0x7a;
    expect(decodeFrame(frame, job)).toBeNull();
  });

  test("refuses a version not asked for, a repeat, a missing required one and trailing bytes", () => {
    expect(decodeFrame(ok([version("main", "a"), version("other", "b")]), job)).toBeNull();
    expect(decodeFrame(ok([version("main", "a"), version("main", "a")]), job)).toBeNull();
    expect(decodeFrame(ok([version("small", "b")]), job)).toBeNull();
    expect(decodeFrame(Buffer.concat([ok([version("main", "a")]), Buffer.from("x")]), job)).toBeNull();
    expect(decodeFrame(new Uint8Array([0, 0]), job)).toBeNull();
  });

  test("refuses a version over its own byte limit", () => {
    expect(decodeFrame(ok([version("main", "a".repeat(1001))]), job)).toBeNull();
  });

  test("holds each version to the size it asked for; a width-only one may be as tall as the source", () => {
    const tallJob: Job = {
      limits: { ...job.limits, maxEdge: 12_000 },
      versions: [{ ...spec("main", true), fit: "width", size: 100 }],
    };
    const sized = (width: number, height: number) => ({ ...version("main", "x"), width, height });
    expect(decodeFrame(ok([sized(100, 6000)]), tallJob)).not.toBeNull();
    expect(decodeFrame(ok([sized(101, 6000)]), tallJob)).toBeNull();
    expect(decodeFrame(ok([sized(100, 12_001)]), tallJob)).toBeNull();
    // An inside fit is held to its size on both sides.
    expect(decodeFrame(ok([sized(100, 101)]), job)).toBeNull();
  });

  test("an unknown refusal says nothing", () => {
    expect(parseRefusal('{"code":"image.animated"}')).toBe("image.animated");
    expect(parseRefusal('{"code":"stack trace here"}')).toBe("image.cannot_use");
    expect(parseRefusal("<html>")).toBe("image.cannot_use");
  });
});
