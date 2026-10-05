// The pinned ThreatExchange PNGs, fetched by scripts/fetch-pdq-vectors.ts (P2.16b). The script checks every file's
// SHA-256, so these tests hash exactly the bytes the expected values were computed from.
import { readFileSync } from "node:fs";
import {
  DIHEDRAL_ORDER,
  type Dihedral,
  hamming,
  pdqDihedral,
  pdqHash,
  pdqPreprocess,
  type RgbImage,
  toHex,
} from "@unset/domains-moderation";
import { beforeAll, describe, expect, test } from "vitest";
import { fetchPdqVectors } from "../../../scripts/fetch-pdq-vectors.ts";
import { FETCHED_EXPECTED } from "./expected.ts";
import { decodePng } from "./png.ts";

/** ThreatExchange's own distance for "the same image" (pdq/README.md:41-45). */
const MATCH_DISTANCE = 31;
const files = new Map<string, Buffer>();

beforeAll(async () => {
  for (const [path, file] of await fetchPdqVectors())
    files.set(path.slice(path.lastIndexOf("/") + 1), readFileSync(file));
}, 130_000);

/** The image as it looks after `variant`, built by moving pixels (what rotating the photo would give). */
function turn(image: RgbImage, variant: Dihedral): RgbImage {
  const { width: w, height: h } = image;
  const swap = !["orig", "rot180", "flipx", "flipy"].includes(variant);
  const [outW, outH] = swap ? [h, w] : [w, h];
  const source: Record<Dihedral, (x: number, y: number) => [number, number]> = {
    orig: (x, y) => [x, y],
    rot90: (x, y) => [w - 1 - y, x], // counter-clockwise, as bridge-2-rotate-90.jpg in the reference data
    rot180: (x, y) => [w - 1 - x, h - 1 - y],
    rot270: (x, y) => [y, h - 1 - x],
    flipx: (x, y) => [x, h - 1 - y],
    flipy: (x, y) => [w - 1 - x, y],
    flipplus1: (x, y) => [y, x],
    flipminus1: (x, y) => [w - 1 - y, h - 1 - x],
  };
  const data = new Uint8Array(image.data.length);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = source[variant](x, y);
      const from = (sy * w + sx) * 3;
      data.set(image.data.subarray(from, from + 3), (y * outW + x) * 3);
    }
  }
  return { width: outW, height: outH, data };
}

describe("pdq on the pinned ThreatExchange images", () => {
  test.each(Object.keys(FETCHED_EXPECTED))("luma_vectors_exact %s", (name) => {
    const luma = pdqPreprocess(decodePng(files.get(name) as Buffer));
    const expected = FETCHED_EXPECTED[name as keyof typeof FETCHED_EXPECTED];
    const hash = pdqHash(luma);
    expect([toHex(hash), hash.quality]).toEqual([expected.hash, expected.quality]);
    expect(pdqDihedral(luma).map(toHex)).toEqual(expected.dihedral);
  });

  // PDQ is not exactly rotation-invariant (pdq/README.md "Note on Dihedral PDQ Hashes"): the reference's own pair
  // bridge-1-original / bridge-2-rotate-90 is 14 bits from its rot90 variant. So the turned image must match its own
  // variant within the matching distance, and be nearer to it than to any other variant.
  test.each(Object.keys(FETCHED_EXPECTED))("dihedral_matches_rotation %s", (name) => {
    const image = decodePng(files.get(name) as Buffer);
    const variants = pdqDihedral(pdqPreprocess(image));
    for (const [index, variant] of DIHEDRAL_ORDER.entries()) {
      const turned = pdqHash(pdqPreprocess(turn(image, variant)));
      const distances = variants.map((v) => hamming(turned, v));
      expect(distances[index], variant).toBeLessThanOrEqual(MATCH_DISTANCE);
      expect(distances.indexOf(Math.min(...distances)), variant).toBe(index);
    }
  });
});
