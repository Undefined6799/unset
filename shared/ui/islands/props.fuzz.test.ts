// Property tests for serializeProps (P1.10): any JSON value survives the trip through an inline script element.
import fc from "fast-check";
import { parse } from "parse5";
import { expect, test } from "vitest";
import { SerializeError, serializeProps } from "./props.ts";

/** Characters that end or confuse a script element; the serialised JSON must hold none of them. */
const BREAKER = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`);
/** The first breaker in the output, named with its index and context, or null when there is none. */
const breakerAt = (json: string): string | null => {
  const found = BREAKER.exec(json);
  if (found === null) return null;
  const context = json.slice(Math.max(0, found.index - 16), found.index + 16);
  return `breaker ${JSON.stringify(found[0])} at index ${found.index}: ${JSON.stringify(context)}`;
};
/** Strings built from the pieces that end or confuse a script element, so escaping is tested where it matters. */
const BREAKER_PIECES = ["</script", "</SCRIPT ", "<script", "<!--", "-->", "<", ">", "&", "/", '"', "\\"].concat([
  String.fromCharCode(0x2028),
  String.fromCharCode(0x2029),
]);
const breakerString = fc
  .array(fc.oneof(fc.constantFrom(...BREAKER_PIECES), fc.string({ maxLength: 3 })), { maxLength: 8 })
  .map((parts) => parts.join(""));
/**
 * Any JSON value, with every size bounded explicitly (P1.23d): the breakers are short, so longer values add time,
 * not coverage. The leaves are fc.jsonValue's own: null, booleans, finite doubles and binary strings.
 */
const jsonString = fc.string({ unit: "binary", maxLength: 256 });
const { json } = fc.letrec((tie) => ({
  json: fc.oneof(
    { maxDepth: 4, depthIdentifier: "json" },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noDefaultInfinity: true, noNaN: true }),
    jsonString,
    fc.array(tie("json"), { maxLength: 16, depthIdentifier: "json" }),
    fc.dictionary(jsonString, tie("json"), { maxKeys: 16, depthIdentifier: "json" }),
  ),
}));
const value = fc.oneof(
  json,
  fc.dictionary(breakerString, breakerString, { maxKeys: 4 }),
  fc.array(breakerString, { maxLength: 4 }),
);
/** JSON has no negative zero: it serialises as `0`, so compare with it normalised. */
const normalise = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const BREAKER_KEY = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`);
/** A key JSON would escape (props.ts refuses these; see props.keys.test.ts), found via the key JSON.stringify writes. */
const hasEscapedKey = (v: unknown): boolean =>
  typeof v === "object" &&
  v !== null &&
  (Array.isArray(v)
    ? v.some(hasEscapedKey)
    : Object.entries(v).some(([k, x]) => /[\\<>&]/.test(JSON.stringify(k)) || BREAKER_KEY.test(k) || hasEscapedKey(x)));
/** The serialised JSON, or null when the value holds an escaped key and is (correctly) refused. */
const serialiseOrRefused = (v: unknown): string | null => {
  if (!hasEscapedKey(v)) return serializeProps(v as never, { maxBytes: 1e9 });
  expect(() => serializeProps(v as never, { maxBytes: 1e9 })).toThrow(SerializeError);
  return null;
};

test("fuzz_roundtrip", () => {
  fc.assert(
    fc.property(value, (v) => {
      const json = serialiseOrRefused(v);
      if (json !== null) expect(JSON.parse(json)).toEqual(normalise(v));
    }),
    { numRuns: 10_000 },
  );
});

test("fuzz_no_breakers", () => {
  fc.assert(
    fc.property(value, (v) => {
      expect(breakerAt(serialiseOrRefused(v) ?? "")).toBeNull();
    }),
    { numRuns: 10_000 },
  );
});

type Node = { nodeName: string; childNodes?: Node[]; value?: string };
const scripts = (node: Node): Node[] => [
  ...(node.nodeName === "script" ? [node] : []),
  ...(node.childNodes ?? []).flatMap(scripts),
];

test("props_breaker_examples_fail", () => {
  const ls = String.fromCharCode(0x2028);
  const ps = String.fromCharCode(0x2029);
  for (const breaker of ["</script", "</ScRiPt>", "<!--", "-->", "<", ">", "&", ls, ps]) {
    const at = '{"a":"'.length + breaker.search(BREAKER);
    expect(breakerAt(`{"a":"${breaker}"}`) ?? "no breaker found", breaker).toMatch(`at index ${at}: `);
    expect(breakerAt(serializeProps({ a: breaker })), breaker).toBeNull();
  }
});

test("html_parse_check", () => {
  fc.assert(
    fc.property(value, (v) => {
      const json = serialiseOrRefused(v);
      if (json === null) return;
      const document = parse(
        `<!doctype html><html><head><script type="application/json" id="p">${json}</script></head><body><p>x</p></body></html>`,
      ) as unknown as Node;
      const found = scripts(document);
      expect(found).toHaveLength(1);
      const text = (found[0]?.childNodes ?? []).map((child) => child.value ?? "").join("");
      expect(text).toBe(json);
    }),
    { numRuns: 1_000 },
  );
});
