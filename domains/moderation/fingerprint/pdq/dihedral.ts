// The eight rotations and flips of a PDQ hash from one DCT (P2.16b), as the reference computes them: each variant
// permutes and negates the 16×16 coefficients instead of re-hashing a turned image. Ported from ThreatExchange PDQ at
// commit 85978d7cabdf631c0e4be9cb2be2816b2b9a6911, portions Copyright (c) Meta Platforms, Inc. and affiliates, BSD
// licence (text in README.md): pdq/cpp/hashing/pdqhashing.cpp:201-307 and 437-530.

import { dctToBits, type PdqHash, pdqDct } from "./pdq.ts";
import type { PdqLuma } from "./preprocess.ts";

/** The reference's output order (pdqDihedralHash256esFromFloatLuma's arguments). */
export const DIHEDRAL_ORDER = [
  "orig",
  "rot90",
  "rot180",
  "rot270",
  "flipx",
  "flipy",
  "flipplus1",
  "flipminus1",
] as const;
export type Dihedral = (typeof DIHEDRAL_ORDER)[number];

const SIDE = 16;

/** Where coefficient (i, j) goes, and whether it is negated, for each variant (the sign tables at pdqhashing.cpp:437-448). */
const MOVES: Record<Dihedral, (i: number, j: number) => { to: number; negate: boolean }> = {
  orig: (i, j) => ({ to: i * SIDE + j, negate: false }),
  rot90: (i, j) => ({ to: j * SIDE + i, negate: (j & 1) === 0 }),
  rot180: (i, j) => ({ to: i * SIDE + j, negate: ((i + j) & 1) === 1 }),
  rot270: (i, j) => ({ to: j * SIDE + i, negate: (i & 1) === 0 }),
  flipx: (i, j) => ({ to: i * SIDE + j, negate: (i & 1) === 0 }),
  flipy: (i, j) => ({ to: i * SIDE + j, negate: (j & 1) === 0 }),
  flipplus1: (i, j) => ({ to: j * SIDE + i, negate: false }),
  flipminus1: (i, j) => ({ to: j * SIDE + i, negate: ((i + j) & 1) === 1 }),
};

function transform(dct: Float32Array, variant: Dihedral): Float32Array {
  const out = new Float32Array(SIDE * SIDE);
  const move = MOVES[variant];
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const { to, negate } = move(i, j);
      const value = dct[i * SIDE + j] as number;
      out[to] = negate ? -value : value;
    }
  }
  return out;
}

/** All eight hashes in DIHEDRAL_ORDER, sharing one quality score; all zero with quality 0 below the hashable size. */
export function pdqDihedral(luma: PdqLuma): PdqHash[] {
  const result = pdqDct(luma, false);
  return DIHEDRAL_ORDER.map((variant) =>
    result === null
      ? { bits: new Uint8Array(32), quality: 0 }
      : { bits: dctToBits(transform(result.dct, variant)), quality: result.quality },
  );
}
