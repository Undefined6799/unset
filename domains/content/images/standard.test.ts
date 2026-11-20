import { describe, expect, test } from "vitest";
import { avatarVersions, DISPLAY_WIDTHS, imageVersions, UPLOAD_LIMITS } from "./standard.ts";

describe("image standard (ADR 0070 point 3)", () => {
  test("the main version fits Bluesky's post-image blob limit and is the only required one", () => {
    const [main, ...rest] = imageVersions();
    expect(main).toMatchObject({ name: "main", format: "jpeg", fit: "inside", size: 2560, required: true });
    expect(main?.maxBytes).toBeLessThanOrEqual(2_000_000);
    expect(rest.every((v) => !v.required && v.fit === "width")).toBe(true);
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

  test("uploads stop at 30 MB, 70 megapixels and 12,000 px a side", () => {
    expect(UPLOAD_LIMITS).toEqual({ maxBytes: 30_000_000, maxPixels: 70_000_000, maxEdge: 12_000 });
  });
});
