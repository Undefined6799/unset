// Review-found gaps in serializeProps (P1.10): slow inputs, values that change between reads, and limit boundaries.
import { expect, test } from "vitest";
import { SerializeError, serializeProps } from "./props.ts";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof SerializeError) return error.code;
    throw error;
  }
  return "serialised";
}

test("shared_subtrees_hit_the_size_limit_fast", () => {
  let value: unknown = "x";
  for (let i = 0; i < 24; i += 1) value = [value, value];
  const started = performance.now();
  expect(codeOf(() => serializeProps(value as never))).toBe("islands.props_too_large");
  expect(performance.now() - started).toBeLessThan(500);
});

test("fan_out_cycle_is_refused_fast", () => {
  const o: Record<string, unknown> = {};
  o.a = o;
  o.b = o;
  const started = performance.now();
  expect(codeOf(() => serializeProps(o as never))).toBe("islands.props_invalid");
  expect(performance.now() - started).toBeLessThan(500);
});

test("accessors_are_refused_and_never_read_twice", () => {
  let reads = 0;
  const flipping = {
    get a() {
      reads += 1;
      return reads === 1 ? "ok" : new Date(0);
    },
  };
  expect(codeOf(() => serializeProps(flipping as never))).toBe("islands.props_invalid");
  const proxy = new Proxy(
    { a: 1 },
    { get: (target, key) => (key === "toJSON" ? () => "0" : Reflect.get(target, key)) },
  );
  expect(serializeProps(proxy as never)).toBe('{"a":1}');
});

test("throwing_traps_are_props_invalid", () => {
  const throwing = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("boom");
      },
    },
  );
  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  const getter = Object.defineProperty({}, "a", {
    enumerable: true,
    get: () => {
      throw new Error("boom");
    },
  });
  for (const value of [throwing, revoked, getter]) {
    expect(codeOf(() => serializeProps(value as never))).toBe("islands.props_invalid");
  }
});

test("dropped_parts_are_refused", () => {
  const withSymbol = { a: 1, [Symbol("s")]: 2 };
  const hidden = Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false });
  const arrayExtra = Object.assign([1], { foo: 1 });
  for (const value of [withSymbol, hidden, arrayExtra]) {
    expect(codeOf(() => serializeProps(value as never))).toBe("islands.props_invalid");
  }
});

test("depth_boundary", () => {
  const nest = (levels: number): unknown => {
    let value: unknown = 0;
    for (let i = 0; i < levels; i += 1) value = [value];
    return value;
  };
  expect(codeOf(() => serializeProps(nest(32) as never))).toBe("serialised");
  expect(codeOf(() => serializeProps(nest(33) as never))).toBe("islands.props_invalid");
});

test("byte_boundary_counts_utf8", () => {
  expect(codeOf(() => serializeProps("x".repeat(15_358)))).toBe("serialised");
  expect(codeOf(() => serializeProps("x".repeat(15_359)))).toBe("islands.props_too_large");
  // é is two bytes: 7 678 of them plus the quotes is 15 358 bytes, one more is over.
  expect(codeOf(() => serializeProps("é".repeat(7_679)))).toBe("serialised");
  expect(codeOf(() => serializeProps("é".repeat(7_680)))).toBe("islands.props_too_large");
});

test("max_bytes_must_be_a_positive_integer", () => {
  for (const maxBytes of [Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    expect(() => serializeProps("x", { maxBytes }), String(maxBytes)).toThrow(RangeError);
  }
});
