import { describe, expect, test } from "vitest";
import { avatarVersions, DISPLAY_WIDTHS, imageVersions, UPLOAD_LIMITS } from "./standard.ts";

describe("image standard (ADR 0070 point 3)", () => {
  test("the main version is a WebP of up to 4,096 px and 5,000,000 bytes, and the only required one (ADR 0088)", () => {
    const [main, ...rest] = imageVersions();
    expect(main).toMatchObject({ name: "main", format: "webp", fit: "inside", size: 4096, required: true });
    expect(main?.maxBytes).toBe(5_000_000);
    expect(rest.every((v) => !v.required && v.fit === "width")).toBe(true);
  });

  test("a main version too large at q75 gives up pixels first, down to ADR 0070's 2560 px at q45", () => {
    const [main] = imageVersions();
    expect(main).toMatchObject({ quality: 90, minQuality: 75, losslessFrom: ["png"] });
    expect(main?.smaller).toEqual([
      { size: 3072, minQuality: 75 },
      { size: 2560, minQuality: 45 },
    ]);
  });

  test("every display width comes in AVIF and WebP, and none is wider than the main version", () => {
    const display = imageVersions().slice(1);
    expect(display.map((v) => `${v.name}.${v.format}`)).toEqual(
      DISPLAY_WIDTHS.flatMap((w) => [`w${w}.avif`, `w${w}.webp`]),
    );
    expect(display.every((v) => v.size < 2560)).toBe(true);
  });

  test("version names are unique and safe as object-key segments", () => {
    for (const versions of [imageVersions(), avatarVersions()]) {
      const keys = versions.map((v) => `${v.name}.${v.format}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.every((k) => /^[a-z0-9_]{1,32}\.(jpeg|webp|avif)$/.test(k))).toBe(true);
    }
  });

  test("the avatar is square, fits Bluesky's avatar limit, and carries the member's crop to every size", () => {
    const crop = { left: 10, top: 20, size: 300 };
    const versions = avatarVersions(crop);
    expect(versions.every((v) => v.fit === "square" && v.crop === crop)).toBe(true);
    expect(versions[0]).toMatchObject({ name: "main", size: 1000, format: "jpeg", required: true });
    expect(versions[0]?.maxBytes).toBeLessThanOrEqual(1_000_000);
    expect(avatarVersions().every((v) => v.crop === undefined)).toBe(true);
  });

  test("uploads stop at 64 MiB, 110 megapixels and 12,000 px a side (ADR 0076)", () => {
    expect(UPLOAD_LIMITS).toEqual({ maxBytes: 64 * 1024 * 1024, maxPixels: 110_000_000, maxEdge: 12_000 });
    // A 60 MB JPEG and a 102-megapixel medium-format frame (11,648 x 8,736) fit.
    expect(UPLOAD_LIMITS.maxBytes).toBeGreaterThanOrEqual(60_000_000);
    expect(11_648 * 8_736).toBeLessThanOrEqual(UPLOAD_LIMITS.maxPixels);
  });
});
