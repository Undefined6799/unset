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
      const made = await makeVersion(open, spec, { format, bytes: bytes.length }, width, height);
      if (made === "too_large") return { kind: "refused", code: "image.too_large" };
      if (made !== "omitted") versions.push(made);
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

/**
 * The version at each of `attempts` until it fits. One that never fits is `too_large` when required, which refuses the
 * upload, and `omitted` when optional: a hard photo never fails on a display size, and the page uses another one.
 */
async function makeVersion(
  open: () => Sharp,
  spec: VersionSpec,
  source: Source,
  width: number,
  height: number,
): Promise<ImageVersion | "too_large" | "omitted"> {
  let fitting: { data: Buffer; info: OutputInfo } | undefined;
  // Each size is decoded and resized once, then encoded at each quality from its pixels: decoding a 100-megapixel
  // upload again for every try is what would cost the time (ADR 0088, measured in the PR).
  let pixels: { size: number; data: Buffer; info: OutputInfo } | undefined;
  for (const step of attempts(spec, source)) {
    if (pixels?.size !== step.size) {
      const sized = shaped(open().rotate(), { ...spec, size: step.size }, width, height);
      pixels = { size: step.size, ...(await sized.raw().toBuffer({ resolveWithObject: true })) };
    }
    const { info } = pixels;
    const raw = sharp(pixels.data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    const out = await encode(raw, spec.format, step).toBuffer({ resolveWithObject: true });
    if (out.data.length <= spec.maxBytes) {
      fitting = out;
      break;
    }
  }
  if (fitting === undefined) return spec.required ? "too_large" : "omitted";
  const { data, info } = fitting;
  return {
    name: spec.name,
    format: spec.format,
    width: info.width,
    height: info.height,
    bytes: new Uint8Array(data),
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

/** One encoding to try: a size and a quality, or lossless. */
export type Attempt =
  | { readonly size: number; readonly quality: number }
  | { readonly size: number; readonly lossless: true };

/** What `attempts` reads of the upload: its format, and its length in bytes. */
export type Source = { readonly format: SourceFormat; readonly bytes: number };

/**
 * The encodings to try, in order (ADR 0088): lossless at the full size first when the source is one of `losslessFrom`
 * and no longer than `maxBytes` (WebP lossless comes out smaller than the PNG it reads, so a PNG photo past the cap is
 * not spent five seconds on), then each size, the largest first, from `quality` down to that size's own minimum.
 */
export function attempts(spec: VersionSpec, source: Source): Attempt[] {
  const lossless = spec.losslessFrom?.includes(source.format) === true && source.bytes <= spec.maxBytes;
  const steps: Attempt[] = lossless ? [{ size: spec.size, lossless: true }] : [];
  const sizes = [{ size: spec.size, minQuality: spec.minQuality }, ...(spec.smaller ?? [])];
  for (const { size, minQuality } of sizes) {
    for (const quality of qualitySteps(spec.quality, minQuality)) steps.push({ size, quality });
  }
  return steps;
}

/** The qualities to try, from `quality` down in steps of 10, always ending on `minQuality`. */
export function qualitySteps(quality: number, minQuality: number): number[] {
  const steps: number[] = [];
  for (let q = quality; q > minQuality; q -= 10) steps.push(q);
  steps.push(minQuality);
  return steps;
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

function encode(image: Sharp, format: VersionSpec["format"], step: Attempt): Sharp {
  // sharp 0.35.5 dist/output.mjs `webp`: `lossless` keeps every pixel; an alpha channel is kept either way.
  if ("lossless" in step) return image.webp({ lossless: true });
  const { quality } = step;
  if (format === "jpeg") return image.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true });
  if (format === "webp") return image.webp({ quality });
  return image.avif({ quality, effort: 4 });
}
