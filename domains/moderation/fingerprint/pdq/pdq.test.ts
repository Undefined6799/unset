import { describe, expect, test } from "vitest";
import { SYNTHETIC_EXPECTED } from "./fixtures/reference-vectors.ts";
import { SYNTHETIC_CASES, syntheticImage } from "./fixtures/synthetic.ts";
import { hamming, pdqHash, toBase64, toHex } from "./pdq.ts";
import { pdqPreprocess } from "./preprocess.ts";

const P95_BUDGET_MS = 150;

describe("pdq", () => {
  // Bit-exact against the C++ reference on the same bytes (ThreatExchange pdq/README.md:33-35, criterion 1).
  test.each(SYNTHETIC_CASES.map((c) => [c.name, c] as const))("luma_vectors_exact %s", (name, spec) => {
    const hash = pdqHash(pdqPreprocess(syntheticImage(spec)));
    const expected = SYNTHETIC_EXPECTED[name as keyof typeof SYNTHETIC_EXPECTED];
    expect([toHex(hash), hash.quality]).toEqual([expected.hash, expected.quality]);
  });

  test("flat_low_quality", () => {
    const flat = SYNTHETIC_CASES.find((c) => c.flat !== undefined);
    expect(flat).toBeDefined();
    expect(pdqHash(pdqPreprocess(syntheticImage(flat as (typeof SYNTHETIC_CASES)[number]))).quality).toBeLessThan(50);
  });

  test("below_hashable_size_is_zero_hash_quality_zero", () => {
    const hash = pdqHash(pdqPreprocess({ width: 4, height: 9, data: new Uint8Array(4 * 9 * 3).fill(99) }));
    expect([toHex(hash), hash.quality]).toEqual(["0".repeat(64), 0]);
  });

  test("timing", () => {
    const luma = pdqPreprocess(syntheticImage({ name: "timing", width: 512, height: 512, seed: 42 }));
    const runs = Array.from({ length: 20 }, () => {
      const start = performance.now();
      pdqHash(luma);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    expect(runs[Math.ceil(runs.length * 0.95) - 1]).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  test("encodings_and_distance", () => {
    const zero = { bits: new Uint8Array(32), quality: 100 };
    const one = { bits: Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 0x81 : 0)), quality: 100 };
    expect(toHex(one)).toBe(`${"0".repeat(62)}81`);
    expect(toBase64(zero)).toBe(`${"A".repeat(43)}=`);
    expect([
      hamming(zero, one),
      hamming(one, one),
      hamming(zero, { ...zero, bits: new Uint8Array(32).fill(255) }),
    ]).toEqual([2, 0, 256]);
  });

  test("input_luma_is_not_modified", () => {
    const luma = pdqPreprocess(syntheticImage({ name: "copy", width: 100, height: 80, seed: 11 }));
    const before = Float32Array.from(luma.data);
    pdqHash(luma);
    expect(luma.data).toEqual(before);
  });
});
