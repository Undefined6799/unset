// Magic-byte sniffing (ADR 0070 point 2.2, book P2.17 `sniffImage`): the declared Content-Type is never trusted. An
// animated PNG, WebP or AVIF is named apart, since a still-image loader would show only its first frame.
import type { SourceFormat } from "@unset/domains-content";

export type Sniffed = SourceFormat | "animated" | null;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));
const u32 = (bytes: Uint8Array, at: number): number =>
  (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0;

const u32le = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)) >>> 0;

export function sniffImage(bytes: Uint8Array): Sniffed {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return pngKind(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return webpKind(bytes);
  if (ascii(bytes, 4, 4) === "ftyp") return isoKind(bytes);
  return null;
}

/** An `acTL` chunk before the first `IDAT` makes an APNG (PNG spec, "APNG" extension, 3rd edition). */
function pngKind(bytes: Uint8Array): Sniffed {
  for (let at = 8; at + 8 <= bytes.length; ) {
    const type = ascii(bytes, at + 4, 4);
    if (type === "acTL") return "animated";
    if (type === "IDAT" || type === "IEND") return "png";
    at += 12 + u32(bytes, at);
  }
  return "png";
}

/** Extended WebP: the `VP8X` animation flag or an `ANIM` chunk (RFC 9649 §2.7). */
function webpKind(bytes: Uint8Array): Sniffed {
  for (let at = 12; at + 8 <= bytes.length; ) {
    const type = ascii(bytes, at, 4);
    if (type === "ANIM" || type === "ANMF") return "animated";
    if (type === "VP8X" && ((bytes[at + 8] ?? 0) & 0x02) !== 0) return "animated";
    const size = u32le(bytes, at + 4);
    at += 8 + size + (size % 2);
  }
  return "webp";
}

/**
 * The ISO-BMFF `ftyp` box: `avif` is a still AVIF, `avis` an image sequence; HEIC and anything else are refused. Real
 * boxes list a handful of brands, so one declaring more than `MAX_FTYP` bytes is refused rather than walked.
 */
function isoKind(bytes: Uint8Array): Sniffed {
  const declared = u32(bytes, 0);
  if (declared > MAX_FTYP) return null;
  const end = Math.min(declared, bytes.length);
  let avif = false;
  for (let at = 8; at + 4 <= end; at += at === 8 ? 8 : 4) {
    const brand = ascii(bytes, at, 4);
    if (brand === "avis") return "animated";
    if (brand === "avif") avif = true;
  }
  return avif ? "avif" : null;
}

const MAX_FTYP = 4096;
