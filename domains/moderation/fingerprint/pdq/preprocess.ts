// PDQ stage 1 (P2.16b): oriented RGB pixels to the luminance the hasher reads. Ported from ThreatExchange PDQ at
// commit 85978d7cabdf631c0e4be9cb2be2816b2b9a6911, portions Copyright (c) Meta Platforms, Inc. and affiliates, BSD
// licence (text in README.md): pdq/cpp/io/pdqio.cpp:22, 32-56 and 102-104, pdq/cpp/downscaling/downscaling.cpp:19-21
// and 101-102. The resize rule is read from CImg's nearest-neighbour case, which the reference calls
// (pdq/cpp/CImg.h:40507-40520, cimg_version 220); no CImg code is copied.

/** The reference squashes an image wider or taller than this to exactly this square. */
export const PDQ_MAX_SIDE = 512;

/** Decoded pixels, already oriented, alpha already removed: `data` is R, G, B per pixel, row by row. */
export type RgbImage = { readonly width: number; readonly height: number; readonly data: Uint8Array };

declare const lumaBrand: unique symbol;
/** Luminance at most 512 on each side, row by row, minted only by `pdqPreprocess`. */
export type PdqLuma = {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  readonly [lumaBrand]: true;
};

// The reference's coefficients are C++ floats; fround gives the same float values.
const LUMA_R = Math.fround(0.299);
const LUMA_G = Math.fround(0.587);
const LUMA_B = Math.fround(0.114);

const isSide = (n: number): boolean => Number.isInteger(n) && n >= 1;

/**
 * The source index CImg's nearest-neighbour resize reads for output index `out`: floor(out * from / to), computed in
 * double as CImg does (`(x + 1.0) * _width / sx`, accumulated).
 */
const sourceIndex = (out: number, from: number, to: number): number =>
  from === to ? out : Math.floor((out * from) / to);

/**
 * Luminance for PDQ. Larger than 512 on either side → squashed to exactly 512×512 by nearest neighbour, as the
 * reference does; otherwise kept at its size, as the reference does. Malformed input is a caller bug: TypeError.
 */
export function pdqPreprocess(image: RgbImage): PdqLuma {
  const { width, height, data } = image;
  if (!isSide(width) || !isSide(height) || data.length !== width * height * 3) {
    throw new TypeError("pdqPreprocess: expected width × height × 3 RGB bytes");
  }
  const squash = width > PDQ_MAX_SIDE || height > PDQ_MAX_SIDE;
  const outWidth = squash ? PDQ_MAX_SIDE : width;
  const outHeight = squash ? PDQ_MAX_SIDE : height;
  const columns = Array.from({ length: outWidth }, (_, x) => sourceIndex(x, width, outWidth));
  const luma = new Float32Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y++) {
    const row = sourceIndex(y, height, outHeight) * width;
    for (let x = 0; x < outWidth; x++) {
      const p = (row + (columns[x] as number)) * 3;
      // float × int, then float + float, left to right, as the reference's one expression evaluates.
      const r = Math.fround(LUMA_R * (data[p] as number));
      const g = Math.fround(LUMA_G * (data[p + 1] as number));
      const b = Math.fround(LUMA_B * (data[p + 2] as number));
      luma[y * outWidth + x] = Math.fround(Math.fround(r + g) + b);
    }
  }
  return { width: outWidth, height: outHeight, data: luma } as PdqLuma;
}
