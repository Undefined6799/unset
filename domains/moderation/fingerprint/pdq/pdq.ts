// PDQ hashing (P2.16b): luminance to a 256-bit perceptual hash and a 0..100 quality score. Ported from ThreatExchange
// PDQ at commit 85978d7cabdf631c0e4be9cb2be2816b2b9a6911, portions Copyright (c) Meta Platforms, Inc. and affiliates,
// BSD licence (text in README.md):
// pdq/cpp/hashing/pdqhashing.cpp, pdq/cpp/downscaling/downscaling.cpp (Jarosz filter, decimation),
// pdq/cpp/hashing/torben.cpp (median) and pdq/cpp/common/pdqhashtypes.{h,cpp} (bit order, hex format).
// The reference computes in C++ `float`; every float operation here is rounded with Math.fround, which gives the
// same result because a double holds the exact sum, difference, product or quotient of two floats before rounding.

import type { PdqLuma } from "./preprocess.ts";

/** 32 bytes in the order the reference prints them (hex word 15 first), and the quality score 0..100. */
export type PdqHash = { readonly bits: Uint8Array; readonly quality: number };

const HASH_BYTES = 32;
/** Smaller than this on either side: the reference returns an all-zero hash of quality 0 (pdqhashing.cpp:64, 133). */
const MIN_HASHABLE_SIDE = 5;
/** Two box passes per axis make a tent filter (pdqhashing.cpp:68). */
const JAROSZ_PASSES = 2;
const DOWNSAMPLED = 64;
const DCT_SIDE = 16;

/** The 16×64 DCT-II matrix, rows 1..16 (pdqhashing.cpp:38-52): float scale × double cosine, stored as float. */
const DCT_MATRIX = (() => {
  const matrix = new Float32Array(DCT_SIDE * DOWNSAMPLED);
  const scale = Math.fround(Math.sqrt(2 / DOWNSAMPLED));
  for (let i = 0; i < DCT_SIDE; i++) {
    for (let j = 0; j < DOWNSAMPLED; j++) {
      matrix[i * DOWNSAMPLED + j] = scale * Math.cos((Math.PI / 2 / DOWNSAMPLED) * (i + 1) * (2 * j + 1));
    }
  }
  return matrix;
})();

/** downscaling.cpp computeJaroszFilterWindowSize. */
const windowSize = (from: number, to: number): number => Math.trunc((from + 2 * to - 1) / (2 * to));

/** One box-filter pass over a strided vector (downscaling.cpp box1DFloat), with its four phases kept. */
function box1D(
  input: Float32Array,
  output: Float32Array,
  start: number,
  length: number,
  stride: number,
  window: number,
) {
  const half = Math.trunc((window + 2) / 2);
  const phases = [half - 1, window - half + 1, length - window, half - 1];
  let [left, right, out, sum, count] = [start, start, start, 0, 0];
  for (let i = 0; i < (phases[0] as number); i++, right += stride, count++)
    sum = Math.fround(sum + (input[right] as number));
  for (let i = 0; i < (phases[1] as number); i++, right += stride, out += stride) {
    sum = Math.fround(sum + (input[right] as number));
    count++;
    output[out] = sum / count;
  }
  for (let i = 0; i < (phases[2] as number); i++, left += stride, right += stride, out += stride) {
    sum = Math.fround(Math.fround(sum + (input[right] as number)) - (input[left] as number));
    output[out] = sum / count;
  }
  for (let i = 0; i < (phases[3] as number); i++, left += stride, out += stride) {
    sum = Math.fround(sum - (input[left] as number));
    count--;
    output[out] = sum / count;
  }
}

/** Blur with the Jarosz tent filter, then pick 64×64 samples (pdqhashing.cpp:173-189). */
function downsample(luma: PdqLuma): Float32Array {
  const { width, height } = luma;
  const work = Float32Array.from(luma.data);
  const scratch = new Float32Array(work.length);
  const alongRows = windowSize(width, DOWNSAMPLED);
  const alongColumns = windowSize(height, DOWNSAMPLED);
  for (let pass = 0; pass < JAROSZ_PASSES; pass++) {
    for (let y = 0; y < height; y++) box1D(work, scratch, y * width, width, 1, alongRows);
    for (let x = 0; x < width; x++) box1D(scratch, work, x, height, width, alongColumns);
  }
  const out = new Float32Array(DOWNSAMPLED * DOWNSAMPLED);
  for (let i = 0; i < DOWNSAMPLED; i++) {
    const row = Math.trunc(((i + 0.5) * height) / DOWNSAMPLED) * width;
    for (let j = 0; j < DOWNSAMPLED; j++) {
      out[i * DOWNSAMPLED + j] = work[row + Math.trunc(((j + 0.5) * width) / DOWNSAMPLED)] as number;
    }
  }
  return out;
}

/** The count of significant gradients, scaled to 0..100 (pdqhashing.cpp pdqImageDomainQualityMetric). */
function quality(image: Float32Array): number {
  let gradients = 0;
  const step = (u: number, v: number) => {
    gradients += Math.abs(Math.trunc(Math.fround(Math.fround(Math.fround(u - v) * 100) / 255)));
  };
  for (let i = 0; i < DOWNSAMPLED - 1; i++) {
    for (let j = 0; j < DOWNSAMPLED; j++) step(image[i * 64 + j] as number, image[(i + 1) * 64 + j] as number);
  }
  for (let i = 0; i < DOWNSAMPLED; i++) {
    for (let j = 0; j < DOWNSAMPLED - 1; j++) step(image[i * 64 + j] as number, image[i * 64 + j + 1] as number);
  }
  return Math.min(100, Math.trunc(gradients / 90));
}

/** B = D A Dᵀ for the 16×16 low frequencies, summed in the reference's order (pdqhashing.cpp dct64To16). */
function dct16(image: Float32Array): Float32Array {
  const partial = new Float32Array(DCT_SIDE * DOWNSAMPLED);
  for (let i = 0; i < DCT_SIDE; i++) {
    for (let j = 0; j < DOWNSAMPLED; j++) {
      let sum = 0;
      for (let k = 0; k < DOWNSAMPLED; k++) {
        sum = Math.fround(sum + Math.fround((DCT_MATRIX[i * 64 + k] as number) * (image[k * 64 + j] as number)));
      }
      partial[i * 64 + j] = sum;
    }
  }
  const out = new Float32Array(DCT_SIDE * DCT_SIDE);
  for (let i = 0; i < DCT_SIDE; i++) {
    for (let j = 0; j < DCT_SIDE; j++) {
      let sum = 0;
      for (let k = 0; k < DOWNSAMPLED; k++) {
        sum = Math.fround(sum + Math.fround((partial[i * 64 + k] as number) * (DCT_MATRIX[j * 64 + k] as number)));
      }
      out[i * DCT_SIDE + j] = sum;
    }
  }
  return out;
}

/** How the values fall around `guess`, with the nearest value on each side (one pass of torben.cpp's loop). */
function around(values: Float32Array, guess: number, min: number, max: number) {
  const tally = { less: 0, greater: 0, equal: 0, maxBelow: min, minAbove: max };
  for (const v of values) {
    if (v < guess) {
      tally.less++;
      tally.maxBelow = Math.max(tally.maxBelow, v);
    } else if (v > guess) {
      tally.greater++;
      tally.minAbove = Math.min(tally.minAbove, v);
    } else {
      tally.equal++;
    }
  }
  return tally;
}

/** Torben's median without sorting (torben.cpp), kept exact so ties resolve as the reference resolves them. */
function torbenMedian(values: Float32Array): number {
  const half = Math.trunc((values.length + 1) / 2);
  let [min, max] = [values[0] as number, values[0] as number];
  for (const v of values) [min, max] = [Math.min(min, v), Math.max(max, v)];
  for (;;) {
    const guess = Math.fround(Math.fround(min + max) / 2);
    const { less, greater, equal, maxBelow, minAbove } = around(values, guess, min, max);
    if (less <= half && greater <= half) {
      if (less >= half) return maxBelow;
      return less + equal >= half ? guess : minAbove;
    }
    if (less > greater) max = maxBelow;
    else min = minAbove;
  }
}

/** Bit i*16+j is set when coefficient (i, j) is above the median; bit k lives in 16-bit word k>>4 (pdqhashtypes.h:98). */
export function dctToBits(dct: Float32Array): Uint8Array {
  const median = torbenMedian(dct);
  const bits = new Uint8Array(HASH_BYTES);
  for (let k = 0; k < DCT_SIDE * DCT_SIDE; k++) {
    if ((dct[k] as number) > median) {
      const word = k >> 4;
      const bit = k & 15;
      const byte = (15 - word) * 2 + (bit < 8 ? 1 : 0);
      bits[byte] = (bits[byte] as number) | (1 << (bit & 7));
    }
  }
  return bits;
}

/**
 * The 16×16 DCT and quality the hash and its dihedral variants share; null below the hashable size. The reference's
 * single hash takes a 64×64 input as it is (pdqhashing.cpp:163-170) while its dihedral path always filters
 * (pdqhashing.cpp:248-264); a window-1 filter is not an exact copy in float, so `exact64` keeps the difference.
 */
export function pdqDct(luma: PdqLuma, exact64: boolean): { dct: Float32Array; quality: number } | null {
  if (luma.width < MIN_HASHABLE_SIDE || luma.height < MIN_HASHABLE_SIDE) return null;
  const isExact = exact64 && luma.width === DOWNSAMPLED && luma.height === DOWNSAMPLED;
  const image = isExact ? Float32Array.from(luma.data) : downsample(luma);
  return { dct: dct16(image), quality: quality(image) };
}

export function pdqHash(luma: PdqLuma): PdqHash {
  const result = pdqDct(luma, true);
  if (result === null) return { bits: new Uint8Array(HASH_BYTES), quality: 0 };
  return { bits: dctToBits(result.dct), quality: result.quality };
}

/** 64 lowercase hex digits, as the reference prints a hash (pdqhashtypes.cpp:19-21). */
export const toHex = (hash: PdqHash): string => Buffer.from(hash.bits).toString("hex");
export const toBase64 = (hash: PdqHash): string => Buffer.from(hash.bits).toString("base64");

/** The number of differing bits, 0..256. */
export function hamming(a: PdqHash, b: PdqHash): number {
  let distance = 0;
  for (let i = 0; i < HASH_BYTES; i++) {
    let x = ((a.bits[i] as number) ^ (b.bits[i] as number)) & 0xff;
    for (; x !== 0; x &= x - 1) distance++;
  }
  return distance;
}
