import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SerializeError, serializeProps } from "./props.ts";

/** The five code points the serialiser must never emit, compared by number so this file holds none of them. */
const BREAKERS = new Set([0x3c, 0x3e, 0x26, 0x2028, 0x2029]);
const hasBreaker = (text: string): boolean => [...text].some((ch) => BREAKERS.has(ch.codePointAt(0) ?? 0));

/** The SerializeError code `run` throws, or "serialised" when it returns. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof SerializeError) return error.code;
    throw error;
  }
  return "serialised";
}

describe("serializeProps", () => {
  test("props_known_answer", () => {
    expect(serializeProps({ a: "</script>" })).toBe('{"a":"\\u003c/script\\u003e"}');
    const output = serializeProps({ a: String.fromCharCode(0x26, 0x2028, 0x2029, 0x3e) });
    expect(output).toContain("\\u0026\\u2028\\u2029\\u003e");
  });

  test("escapes_html_breakers", () => {
    const value = {
      a: "</script><script>alert(1)</script>",
      b: "<!--",
      c: "a&b",
      d: String.fromCharCode(0x2028, 0x2029),
    };
    const output = serializeProps(value);
    expect(hasBreaker(output)).toBe(false);
    expect(JSON.parse(output)).toEqual(value);
  });

  test("no_literal_separators_in_source", () => {
    const source = readFileSync(join(import.meta.dirname, "props.ts"), "utf8");
    expect([...source].some((ch) => ch.codePointAt(0) === 0x2028 || ch.codePointAt(0) === 0x2029)).toBe(false);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["undefined in an object", { a: undefined }],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["a bigint", 1n],
    ["a class instance", new (class Box {})()],
    ["an array subclass", new (class List extends Array {})()],
    ["a sparse array", Object.assign(new Array(3), { 0: 1, 2: 3 })],
  ])("rejects_non_json %s", (_kind, value) => {
    expect(codeOf(() => serializeProps(value as never))).toBe("islands.props_invalid");
  });

  test("rejects_cycle", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(codeOf(() => serializeProps(a as never))).toBe("islands.props_invalid");
  });

  test("shared_subtrees_are_not_cycles", () => {
    const shared = { x: 1 };
    expect(JSON.parse(serializeProps({ a: shared, b: shared }))).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  test("rejects_deep_nesting", () => {
    let value: unknown = 0;
    for (let i = 0; i < 100_000; i += 1) value = [value];
    expect(codeOf(() => serializeProps(value as never))).toBe("islands.props_invalid");
  });

  test("rejects_too_large", () => {
    expect(codeOf(() => serializeProps({ a: "x".repeat(20_000) }))).toBe("islands.props_too_large");
    expect(codeOf(() => serializeProps("abc", { maxBytes: 4 }))).toBe("islands.props_too_large");
    expect(serializeProps("ab", { maxBytes: 4 })).toBe('"ab"');
  });

  test("proto_key_roundtrip", () => {
    const value = JSON.parse('{"__proto__": {"x": 1}}');
    const parsed = JSON.parse(serializeProps(value));
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed).toEqual(value);
  });

  test("negative_zero_becomes_zero", () => {
    expect(serializeProps(-0)).toBe("0");
  });

  test("null_prototype_objects_allowed", () => {
    const value = Object.assign(Object.create(null) as Record<string, number>, { a: 1 });
    expect(serializeProps(value)).toBe('{"a":1}');
  });
});

// Object keys that JSON would escape are refused (P1.10). V8's JSON.parse (Node 26.10 / V8 14.6, and Chrome 141)
// can return the previous object's key for an escaped one-character key, so an escaped key cannot round-trip.
describe("escaped keys", () => {
  const ch = (code: number): string => String.fromCharCode(code);

  test("v8_escaped_key_mixup_is_real", () => {
    // The engine bug this guard exists for; if V8 fixes it, this test fails and the guard can be reconsidered.
    JSON.parse('{"x":1,"\\\\":1}');
    expect(Object.keys(JSON.parse('{"x":1,"\\n":1}'))).toEqual(["x", "\\"]);
  });

  test("escaped_keys_are_refused", () => {
    const keys = [
      "<",
      ">",
      "&",
      '"',
      "\\",
      "\n",
      ch(0),
      ch(0x1f),
      ch(0x2028),
      ch(0x2029),
      ch(0xd800),
      `a${ch(0xdc00)}`,
    ];
    for (const key of keys) expect(codeOf(() => serializeProps({ [key]: 1 }))).toBe("islands.props_invalid");
    expect(codeOf(() => serializeProps({ ok: { "</script": 1 } }))).toBe("islands.props_invalid");
  });

  test("plain_keys_still_round_trip", () => {
    const value = { "": 1, "data-id": 2, été: 3, "\u{1f600}": 4, __proto__x: 5 };
    expect(JSON.parse(serializeProps(value))).toEqual(value);
  });

  test("breaker_values_still_allowed", () => {
    const value = { text: `</script><!--&${ch(0x2028)}"\\` };
    expect(JSON.parse(serializeProps(value))).toEqual(value);
  });
});

// Review-found gaps in serializeProps (P1.10): slow inputs, values that change between reads, and limit boundaries.
describe("review-found gaps", () => {
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
});
