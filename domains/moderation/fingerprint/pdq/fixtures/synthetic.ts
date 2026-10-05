// Deterministic test images for the PDQ vectors (P2.16b). Integer arithmetic only, so every runtime produces the same
// bytes; the README says how the expected hashes were made from these bytes with the C++ reference.
import type { RgbImage } from "../preprocess.ts";

export type SyntheticCase = {
  name: string;
  width: number;
  height: number;
  seed: number;
  flat?: [number, number, number];
};

/** Sizes that cover each path: squashed on both sides, on one side (the other stretched), kept, 64×64, too small. */
export const SYNTHETIC_CASES: readonly SyntheticCase[] = [
  { name: "landscape-640x480", width: 640, height: 480, seed: 1 },
  { name: "square-512", width: 512, height: 512, seed: 2 },
  { name: "small-300x200", width: 300, height: 200, seed: 3 },
  { name: "wide-1000x333", width: 1000, height: 333, seed: 4 },
  { name: "tall-37x900", width: 37, height: 900, seed: 5 },
  { name: "exact-64", width: 64, height: 64, seed: 6 },
  { name: "edge-5x5", width: 5, height: 5, seed: 7 },
  { name: "tiny-4x4", width: 4, height: 4, seed: 8 },
  { name: "flat-200x150", width: 200, height: 150, seed: 9, flat: [120, 60, 200] },
];

/** xorshift32: a fixed, portable pseudo-random sequence. */
function random(seed: number): () => number {
  let state = seed * 0x9e3779b1 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

/** Random rectangles of colour over a diagonal gradient, plus a little noise: structure at several scales. */
export function syntheticImage(spec: SyntheticCase): RgbImage {
  const { width, height } = spec;
  const data = new Uint8Array(width * height * 3);
  const next = random(spec.seed);
  if (spec.flat !== undefined) {
    for (let p = 0; p < width * height; p++) data.set(spec.flat, p * 3);
    return { width, height, data };
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = ((x * 255) / width + (y * 255) / height) >> 1;
      data.set([base, 255 - base, (base * 3) & 255], (y * width + x) * 3);
    }
  }
  for (let n = 0; n < 24; n++) {
    const [x0, y0] = [next() % width, next() % height];
    const [w, h] = [1 + (next() % Math.max(1, width >> 2)), 1 + (next() % Math.max(1, height >> 2))];
    const colour = [next() & 255, next() & 255, next() & 255];
    for (let y = y0; y < Math.min(height, y0 + h); y++) {
      for (let x = x0; x < Math.min(width, x0 + w); x++) data.set(colour, (y * width + x) * 3);
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, (data[i] as number) + (next() & 7));
  return { width, height, data };
}
