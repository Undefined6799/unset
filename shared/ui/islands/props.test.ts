import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { renderPropsTag, SerializeError, serializeProps } from "./props.ts";

/** The five code points the serialiser must never emit, compared by number so this file holds none of them. */
const BREAKERS = new Set([0x3c, 0x3e, 0x26, 0x2028, 0x2029]);
const hasBreaker = (text: string): boolean => [...text].some((ch) => BREAKERS.has(ch.codePointAt(0) ?? 0));

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof SerializeError) return error.code;
    throw error;
  }
  throw new Error("expected serializeProps to throw");
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

describe("renderPropsTag", () => {
  test("id_validation", () => {
    for (const id of ["A b", "", "1a", "a_b", `a${"b".repeat(41)}`, 'a"><script>']) {
      expect(() => renderPropsTag(id, {}), id).toThrow();
    }
    expect(renderPropsTag(`a${"b".repeat(40)}`, { a: "<" })).toEqual({
      id: `a${"b".repeat(40)}`,
      json: '{"a":"\\u003c"}',
    });
  });
});
