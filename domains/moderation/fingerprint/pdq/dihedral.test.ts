import { describe, expect, test } from "vitest";
import { DIHEDRAL_ORDER, pdqDihedral } from "./dihedral.ts";
import { SYNTHETIC_EXPECTED } from "./fixtures/reference-vectors.ts";
import { SYNTHETIC_CASES, syntheticImage } from "./fixtures/synthetic.ts";
import { pdqHash, toHex } from "./pdq.ts";
import { pdqPreprocess } from "./preprocess.ts";

describe("pdqDihedral", () => {
  test.each(SYNTHETIC_CASES.map((c) => [c.name, c] as const))("dihedral_vectors_exact %s", (name, spec) => {
    const hashes = pdqDihedral(pdqPreprocess(syntheticImage(spec)));
    const expected = SYNTHETIC_EXPECTED[name as keyof typeof SYNTHETIC_EXPECTED];
    expect(hashes.map(toHex)).toEqual(expected.dihedral);
    expect(new Set(hashes.map((h) => h.quality))).toEqual(new Set([expected.quality]));
  });

  test("orig_equals_single_hash", () => {
    const luma = pdqPreprocess(syntheticImage({ name: "orig", width: 400, height: 300, seed: 12 }));
    expect(toHex(pdqDihedral(luma)[DIHEDRAL_ORDER.indexOf("orig")] as never)).toBe(toHex(pdqHash(luma)));
  });
});
