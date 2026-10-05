import { describe, expect, test } from "vitest";
import { PDQ_MAX_SIDE, pdqPreprocess } from "./preprocess.ts";

const rgb = (width: number, height: number, fill = (_p: number) => 0) => ({
  width,
  height,
  data: Uint8Array.from({ length: width * height * 3 }, (_, i) => fill(i)),
});

describe("pdqPreprocess", () => {
  test("malformed_input_is_a_type_error", () => {
    for (const bad of [rgb(4, 4), { ...rgb(4, 4), width: 0 }, { ...rgb(4, 4), height: 2.5 }]) {
      const image = bad.width === 4 && bad.height === 4 ? { ...bad, data: bad.data.subarray(1) } : bad;
      expect(() => pdqPreprocess(image)).toThrow(TypeError);
    }
  });

  test("larger_side_squashes_to_exactly_512_square", () => {
    for (const [w, h] of [
      [1000, 333],
      [37, 900],
      [513, 512],
    ] as const) {
      const luma = pdqPreprocess(rgb(w, h));
      expect([luma.width, luma.height]).toEqual([PDQ_MAX_SIDE, PDQ_MAX_SIDE]);
    }
  });

  test("small_image_keeps_its_size", () => {
    const luma = pdqPreprocess(rgb(300, 200));
    expect([luma.width, luma.height, luma.data.length]).toEqual([300, 200, 60_000]);
  });

  test("luminance_uses_reference_weights", () => {
    // One pixel each of pure red, green and blue: the float weights 0.299, 0.587, 0.114 times 255.
    const luma = pdqPreprocess({ width: 3, height: 1, data: Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255) });
    expect([...luma.data]).toEqual([0.299, 0.587, 0.114].map((c) => Math.fround(Math.fround(c) * 255)));
  });

  test("nearest_neighbour_reads_floor_of_scaled_index", () => {
    // 1024 columns, each its own grey level mod 256: output column x reads source column floor(x * 1024 / 512) = 2x.
    const luma = pdqPreprocess(rgb(1024, 1, (i) => Math.trunc(i / 3) % 256));
    expect(luma.data[0]).toBe(0);
    expect(luma.data[100]).toBeCloseTo(200, 3);
  });
});
