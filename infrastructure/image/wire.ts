// What crosses between web and the review process (ADR 0070 point 2.2): web sends the bytes with the job (its limits
// and the versions it wants) and gets the versions back; nothing else crosses. Both sides parse what they receive, as
// each is the other's trust boundary: review must not let a job ask for unbounded work, and web must not trust a
// review child an exploit may have taken over to say which bytes are which.
//
// Request: POST /v1/process, the image as the body, the job as base64url JSON in the `x-unset-job` header.
// Answer: 200 with a frame (4-byte big-endian manifest length, the manifest JSON, then each version's bytes in
// manifest order), or a refusal as JSON `{ "code": ... }` with 422 (the file) or 503 (busy).
import { createHash } from "node:crypto";
import type {
  ImageRefusal,
  ImageVersion,
  OutputFormat,
  ProcessLimits,
  ProcessResult,
  SourceFormat,
  VersionSpec,
} from "@unset/domains-content";

export const PROCESS_PATH = "/v1/process";
export const JOB_HEADER = "x-unset-job";
export const FRAME_TYPE = "application/vnd.unset.image-versions";

/** What review will ever do for one job, whatever a job asks: the upload ceilings of ADR 0076 with headroom. */
export const JOB_CEILING = {
  maxBytes: 64 * 1024 * 1024,
  maxPixels: 120_000_000,
  maxEdge: 16_384,
  versions: 12,
  size: 4096,
  /** The main version's 5,000,000 bytes (ADR 0088). */
  versionBytes: 5_000_000,
  /** Smaller sizes a version may fall back to (ADR 0088: two). */
  smaller: 4,
} as const;

export type Job = { readonly limits: ProcessLimits; readonly versions: readonly VersionSpec[] };

const NAME = /^[a-z0-9_]{1,32}$/;
const OUTPUTS: readonly OutputFormat[] = ["jpeg", "webp", "avif"];
const SOURCES: readonly SourceFormat[] = ["jpeg", "png", "webp", "avif"];
const FITS: readonly VersionSpec["fit"][] = ["inside", "width", "square"];
const REFUSALS: readonly ImageRefusal[] = [
  "image.too_large",
  "image.unsupported",
  "image.too_many_pixels",
  "image.animated",
  "image.cannot_use",
  "image.busy",
  "image.timeout",
];

export const encodeJob = (job: Job): string => Buffer.from(JSON.stringify(job)).toString("base64url");

/** The job a request names, or null when it is malformed or asks for more than JOB_CEILING allows. */
export function parseJob(header: string | undefined): Job | null {
  if (header === undefined || header.length > 8192) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.limits) || !Array.isArray(raw.versions)) return null;
  const { maxBytes, maxPixels, maxEdge } = raw.limits;
  if (!within(maxBytes, 1, JOB_CEILING.maxBytes) || !within(maxPixels, 1, JOB_CEILING.maxPixels)) return null;
  if (!within(maxEdge, 1, JOB_CEILING.maxEdge)) return null;
  if (raw.versions.length < 1 || raw.versions.length > JOB_CEILING.versions) return null;
  const versions: VersionSpec[] = [];
  for (const v of raw.versions) {
    const spec = parseSpec(v);
    if (spec === null) return null;
    versions.push(spec);
  }
  const keys = new Set(versions.map((v) => `${v.name}.${v.format}`));
  if (keys.size !== versions.length) return null;
  return { limits: { maxBytes, maxPixels, maxEdge }, versions };
}

function parseSpec(v: unknown): VersionSpec | null {
  if (!isRecord(v) || typeof v.name !== "string" || !NAME.test(v.name)) return null;
  if (!OUTPUTS.includes(v.format as OutputFormat) || !FITS.includes(v.fit as VersionSpec["fit"])) return null;
  if (!within(v.size, 16, JOB_CEILING.size) || !within(v.maxBytes, 1000, JOB_CEILING.versionBytes)) return null;
  if (!within(v.quality, 1, 100) || !within(v.minQuality, 1, v.quality as number)) return null;
  if (typeof v.required !== "boolean") return null;
  let crop: VersionSpec["crop"];
  if (v.crop !== undefined) {
    if (v.fit !== "square" || !isRecord(v.crop)) return null;
    const { left, top, size } = v.crop;
    if (!within(left, 0, JOB_CEILING.maxEdge) || !within(top, 0, JOB_CEILING.maxEdge)) return null;
    if (!within(size, 1, JOB_CEILING.maxEdge)) return null;
    crop = { left, top, size };
  }
  const smaller = parseSmaller(v.smaller, v.size as number, v.quality as number);
  const losslessFrom = parseLossless(v.losslessFrom, v.format as OutputFormat);
  if (smaller === null || losslessFrom === null) return null;
  return {
    name: v.name,
    format: v.format as OutputFormat,
    fit: v.fit as VersionSpec["fit"],
    size: v.size,
    ...(crop ? { crop } : {}),
    quality: v.quality,
    minQuality: v.minQuality,
    maxBytes: v.maxBytes,
    required: v.required,
    ...(smaller ? { smaller } : {}),
    ...(losslessFrom ? { losslessFrom } : {}),
  };
}

/** Smaller sizes, each below the one before and at least 16 px, with a minimum quality up to the first quality. */
function parseSmaller(
  raw: unknown,
  size: number,
  quality: number,
): NonNullable<VersionSpec["smaller"]> | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > JOB_CEILING.smaller) return null;
  const out: { size: number; minQuality: number }[] = [];
  let above = size;
  for (const step of raw) {
    if (!isRecord(step) || !within(step.size, 16, above - 1) || !within(step.minQuality, 1, quality)) return null;
    out.push({ size: step.size, minQuality: step.minQuality });
    above = step.size;
  }
  return out;
}

/** Lossless sources: formats we read, each once, and only for a WebP version (sharp writes lossless WebP only). */
function parseLossless(
  raw: unknown,
  format: OutputFormat,
): NonNullable<VersionSpec["losslessFrom"]> | undefined | null {
  if (raw === undefined) return undefined;
  if (format !== "webp" || !Array.isArray(raw) || raw.length < 1) return null;
  if (!raw.every((f) => SOURCES.includes(f as SourceFormat)) || new Set(raw).size !== raw.length) return null;
  return raw as SourceFormat[];
}

type Manifest = {
  readonly source: { readonly format: SourceFormat; readonly width: number; readonly height: number };
  readonly versions: readonly (Omit<ImageVersion, "bytes"> & { readonly length: number })[];
};

export function encodeFrame(result: Extract<ProcessResult, { kind: "ok" }>): Buffer {
  const manifest: Manifest = {
    source: result.source,
    versions: result.versions.map(({ bytes, ...meta }) => ({ ...meta, length: bytes.length })),
  };
  const json = Buffer.from(JSON.stringify(manifest));
  const head = Buffer.alloc(4);
  head.writeUInt32BE(json.length);
  return Buffer.concat([head, json, ...result.versions.map((v) => v.bytes)]);
}

/**
 * The versions in a frame, or null when anything is off: a length that does not add up, a version web did not ask
 * for or asked for once and got twice, a required one missing, a size over its spec, or bytes whose SHA-256 is not
 * the one the manifest claims.
 */
export function decodeFrame(frame: Uint8Array, job: Job): Extract<ProcessResult, { kind: "ok" }> | null {
  const buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32BE(0);
  if (length > 65_536 || 4 + length > buffer.length) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(manifest) || !isRecord(manifest.source) || !Array.isArray(manifest.versions)) return null;
  const { format, width, height } = manifest.source;
  if (!SOURCES.includes(format as SourceFormat)) return null;
  if (!within(width, 1, job.limits.maxEdge) || !within(height, 1, job.limits.maxEdge)) return null;
  const specs = new Map(job.versions.map((v) => [`${v.name}.${v.format}`, v]));
  const seen = new Set<string>();
  const versions: ImageVersion[] = [];
  let offset = 4 + length;
  for (const meta of manifest.versions) {
    if (!isRecord(meta) || typeof meta.name !== "string" || typeof meta.format !== "string") return null;
    const key = `${meta.name}.${meta.format}`;
    const spec = specs.get(key);
    if (spec === undefined || seen.has(key)) return null;
    seen.add(key);
    if (!within(meta.length, 1, spec.maxBytes) || offset + meta.length > buffer.length) return null;
    // The pool's rule: a version is no larger than it asked for, and `width` bounds only the width, so a width-only
    // version of a tall picture may be as tall as the source's own edge limit.
    const tallest = spec.fit === "width" ? job.limits.maxEdge : spec.size;
    if (!within(meta.width, 1, spec.size) || !within(meta.height, 1, tallest)) return null;
    const bytes = new Uint8Array(buffer.subarray(offset, offset + meta.length));
    offset += meta.length;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (meta.sha256 !== sha256) return null;
    versions.push({ name: spec.name, format: spec.format, width: meta.width, height: meta.height, bytes, sha256 });
  }
  if (offset !== buffer.length) return null;
  if (job.versions.some((v) => v.required && !seen.has(`${v.name}.${v.format}`))) return null;
  return { kind: "ok", source: { format: format as SourceFormat, width, height }, versions };
}

/** A refusal's code from review's JSON answer; anything unknown reads as `image.cannot_use`. */
export function parseRefusal(body: string): ImageRefusal {
  try {
    const raw: unknown = JSON.parse(body);
    if (isRecord(raw) && REFUSALS.includes(raw.code as ImageRefusal)) return raw.code as ImageRefusal;
  } catch {
    // Falls through to the one code that says nothing.
  }
  return "image.cannot_use";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const within = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
