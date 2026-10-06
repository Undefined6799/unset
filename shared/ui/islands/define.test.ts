import { expect, test } from "vitest";
import { defineIsland, ISLAND_MAX_PROPS_BYTES } from "./define.ts";

const schema = (v: unknown): v is { a: number } => typeof v === "object" && v !== null;

test("define_island_props_limit", () => {
  expect(defineIsland(() => null, { propsSchema: schema }).maxPropsBytes).toBe(ISLAND_MAX_PROPS_BYTES);
  expect(defineIsland(() => null, { propsSchema: schema, maxPropsBytes: 1024 }).maxPropsBytes).toBe(1024);
  for (const maxPropsBytes of [0, -1, 1.5, ISLAND_MAX_PROPS_BYTES + 1, Number.NaN]) {
    expect(() => defineIsland(() => null, { propsSchema: schema, maxPropsBytes }), String(maxPropsBytes)).toThrow(
      RangeError,
    );
  }
});
