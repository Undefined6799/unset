// The image standard (ADR 0070 point 3, upload numbers raised by ADR 0076): what a member may upload and the versions we keep of it. One place for the
// numbers, so the upload route, review's processing and the pages agree.
import type { ProcessLimits, SquareCrop, VersionSpec } from "./processing.ts";

/**
 * JPEG, PNG, WebP or AVIF, up to 64 MiB, 110 megapixels and 12,000 px a side (ADR 0076): a 102-megapixel
 * medium-format frame at camera JPEG quality fits. The versions we keep stay at ADR 0070's sizes.
 */
export const UPLOAD_LIMITS: ProcessLimits = { maxBytes: 64 * 1024 * 1024, maxPixels: 110_000_000, maxEdge: 12_000 };

/** The PDS blob every atproto app sees: Bluesky's post-image ceiling (app.bsky.embed.images, 2,000,000 bytes). */
const MAIN: VersionSpec = {
  name: "main",
  format: "jpeg",
  fit: "inside",
  size: 2560,
  quality: 85,
  minQuality: 45,
  maxBytes: 2_000_000,
  required: true,
};

/** The widths pages choose from (srcset); each in AVIF and WebP. Never wider than the picture itself. */
export const DISPLAY_WIDTHS = [480, 960, 1600] as const;

const display = (width: number, format: "avif" | "webp"): VersionSpec => ({
  name: `w${width}`,
  format,
  fit: "width",
  size: width,
  quality: format === "avif" ? 60 : 75,
  minQuality: 30,
  maxBytes: width * 250,
  required: false,
});

/** The versions of a general image: proportions kept, no crop (a crop is the use's `fill`, applied when shown). */
export function imageVersions(): VersionSpec[] {
  return [MAIN, ...DISPLAY_WIDTHS.flatMap((w) => [display(w, "avif"), display(w, "webp")])];
}

/** Bluesky's avatar limit (app.bsky.actor.profile, 1,000,000 bytes), so the same picture fits there too. */
const AVATAR_BYTES = 1_000_000;

/** The avatar: the member's chosen square (the centre square when none), 1000 px, plus two small display sizes. */
export function avatarVersions(crop?: SquareCrop): VersionSpec[] {
  const square = (name: string, size: number, format: VersionSpec["format"], maxBytes: number): VersionSpec => ({
    name,
    format,
    fit: "square",
    size,
    ...(crop ? { crop } : {}),
    quality: 85,
    minQuality: 45,
    maxBytes,
    required: name === "main",
  });
  return [
    square("main", 1000, "jpeg", AVATAR_BYTES),
    square("s256", 256, "webp", 40_000),
    square("s128", 128, "webp", 15_000),
  ];
}
