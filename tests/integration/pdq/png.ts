// A minimal PNG decoder for the fetched reference images (P2.16b tests only): 8-bit RGB or RGBA, not interlaced, the
// five scanline filters of the PNG spec (https://www.w3.org/TR/png-3/ §7.3 and §9). PNG is lossless, so every correct
// decoder yields these exact bytes; alpha is dropped, as the caller of pdqPreprocess must do.
import { inflateSync } from "node:zlib";
import type { RgbImage } from "@unset/domains-moderation";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

type Header = { width: number; height: number; channels: number };

/** IHDR and the concatenated IDAT data; chunk CRCs are not checked (the file's SHA-256 already is). */
function readChunks(file: Buffer): { header: Header; compressed: Buffer } {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let header: Header | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString("latin1", at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      const [depth, colour, interlace] = [body[8], body[9], body[12]];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error("unsupported PNG");
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), channels: colour === 6 ? 4 : 3 };
    }
    if (type === "IDAT") idat.push(body);
    at += 12 + length;
  }
  if (header === null) throw new Error("PNG without IHDR");
  return { header, compressed: Buffer.concat(idat) };
}

/** The filter's prediction for byte `at` from its left (a), up (b) and up-left (c) neighbours. */
function predict(pixels: Uint8Array, at: number, x: number, y: number, header: Header, filter: number): number {
  const [stride, step] = [header.width * header.channels, header.channels];
  const a = x >= step ? (pixels[at - step] as number) : 0;
  const b = y > 0 ? (pixels[at - stride] as number) : 0;
  const c = x >= step && y > 0 ? (pixels[at - stride - step] as number) : 0;
  const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
  if (predictor === undefined) throw new Error("bad PNG filter");
  return predictor;
}

/** Undo the per-scanline filters: None, Sub, Up, Average, Paeth. */
function unfilter(raw: Buffer, header: Header): Uint8Array {
  const stride = header.width * header.channels;
  const pixels = new Uint8Array(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      pixels[at] = ((raw[y * (stride + 1) + 1 + x] as number) + predict(pixels, at, x, y, header, filter)) & 0xff;
    }
  }
  return pixels;
}

export function decodePng(file: Buffer): RgbImage {
  const { header, compressed } = readChunks(file);
  const { width, height, channels } = header;
  const pixels = unfilter(inflateSync(compressed), header);
  const data = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) data.set(pixels.subarray(p * channels, p * channels + 3), p * 3);
  return { width, height, data };
}
