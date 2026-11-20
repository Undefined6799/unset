// One processing job, run inside a child process (child.ts): check the decoded picture against the limits, then make
// each version. Every version is turned upright, converted to sRGB and written with no metadata (sharp drops EXIF,
// XMP, IPTC and ICC unless asked to keep them: sharp 0.35.5 dist/output.mjs `keepMetadata`), so the bytes as
// uploaded never leave this function.
import { createHash } from "node:crypto";
import type { ImageRefusal, ImageVersion, ProcessLimits, SourceFormat, VersionSpec } from "@unset/domains-content";
import sharp, { type Metadata, type OutputInfo, type Sharp } from "sharp";

export type JobResult =
  | { kind: "ok"; width: number; height: number; versions: ImageVersion[] }
  | { kind: "refused"; code: ImageRefusal };

/** libvips' own name for each format we accept (an AVIF reads as `heif`, sharp 0.35.5 dist/input.mjs). */
const LIBVIPS_FORMAT: Record<SourceFormat, string> = { jpeg: "jpeg", png: "png", webp: "webp", avif: "heif" };

/**
 * Only the four buffer loaders we accept may run, whatever the bytes claim (sharp 0.35.5 dist/utility.mjs:220-271,
 * `block` and `unblock`). Called once when the child starts.
 */
export function lockDownLoaders(): void {
  sharp.cache(false);
  sharp.concurrency(1);
  sharp.block({ operation: ["VipsForeignLoad"] });
  sharp.unblock({
    operation: [
      "VipsForeignLoadJpegBuffer",
      "VipsForeignLoadPngBuffer",
      "VipsForeignLoadWebpBuffer",
      "VipsForeignLoadHeifBuffer",
    ],
  });
}

export async function runJob(
  bytes: Uint8Array,
  format: SourceFormat,
  limits: ProcessLimits,
  specs: readonly VersionSpec[],
): Promise<JobResult> {
  // failOn 'warning' is sharp's strictest setting: a truncated file fails instead of decoding half a picture.
  const open = () => sharp(bytes, { limitInputPixels: limits.maxPixels, failOn: "warning", sequentialRead: true });
  let meta: Metadata;
  try {
    meta = await open().metadata();
  } catch (error) {
    return refusal(error);
  }
  if (meta.format !== LIBVIPS_FORMAT[format]) return { kind: "refused", code: "image.cannot_use" };
  // An ftyp can list both avif and heic brands; only an AV1-coded HEIF is an AVIF (sharp 0.35.5 dist/input.mjs).
  if (format === "avif" && meta.compression !== "av1") return { kind: "refused", code: "image.cannot_use" };
  if ((meta.pages ?? 1) > 1) return { kind: "refused", code: "image.animated" };
  if (meta.width > limits.maxEdge || meta.height > limits.maxEdge)
    return { kind: "refused", code: "image.too_many_pixels" };
  const turned = (meta.orientation ?? 1) >= 5;
  const [width, height] = turned ? [meta.height, meta.width] : [meta.width, meta.height];
  const versions: ImageVersion[] = [];
  try {
    for (const spec of specs) {
      const made = await makeVersion(open, spec, width, height);
      if (made === null) return { kind: "refused", code: "image.too_large" };
      versions.push(made);
    }
  } catch (error) {
    return refusal(error);
  }
  return { kind: "ok", width, height, versions };
}

function refusal(error: unknown): JobResult {
  const tooMany = error instanceof Error && /pixel limit/i.test(error.message);
  return { kind: "refused", code: tooMany ? "image.too_many_pixels" : "image.cannot_use" };
}

/** The version at falling qualities until it fits; null when a required one never does. */
async function makeVersion(
  open: () => Sharp,
  spec: VersionSpec,
  width: number,
  height: number,
): Promise<ImageVersion | null> {
  let smallest: { data: Buffer; info: OutputInfo } | undefined;
  for (let quality = spec.quality; quality >= spec.minQuality; quality -= 10) {
    const out = await encode(shaped(open().rotate(), spec, width, height), spec.format, quality).toBuffer({
      resolveWithObject: true,
    });
    if (smallest === undefined || out.data.length < smallest.data.length) smallest = out;
    if (out.data.length <= spec.maxBytes) break;
  }
  if (smallest === undefined) return null;
  if (smallest.data.length > spec.maxBytes && spec.required) return null;
  const { data, info } = smallest;
  return {
    name: spec.name,
    format: spec.format,
    width: info.width,
    height: info.height,
    bytes: new Uint8Array(data),
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

function shaped(image: Sharp, spec: VersionSpec, width: number, height: number): Sharp {
  const srgb = image.toColourspace("srgb");
  if (spec.fit === "inside")
    return srgb.resize({ width: spec.size, height: spec.size, fit: "inside", withoutEnlargement: true });
  if (spec.fit === "width") return srgb.resize({ width: spec.size, withoutEnlargement: true });
  const side = Math.min(width, height);
  const crop = spec.crop ?? { left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2), size: side };
  const inside = crop.left >= 0 && crop.top >= 0 && crop.left + crop.size <= width && crop.top + crop.size <= height;
  if (!(inside && crop.size > 0)) throw new RangeError("crop outside the picture");
  return srgb
    .extract({ left: crop.left, top: crop.top, width: crop.size, height: crop.size })
    .resize(spec.size, spec.size);
}

function encode(image: Sharp, format: VersionSpec["format"], quality: number): Sharp {
  if (format === "jpeg") return image.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true });
  if (format === "webp") return image.webp({ quality });
  return image.avif({ quality, effort: 4 });
}
