// Property tests for serializeProps (P1.10): any JSON value survives the trip through an inline script element.
import fc from "fast-check";
import { parse } from "parse5";
import { expect, test } from "vitest";
import { SerializeError, serializeProps } from "./props.ts";

const BREAKERS = new Set([0x3c, 0x3e, 0x26, 0x2028, 0x2029]);
/** Strings built from the pieces that end or confuse a script element, so escaping is tested where it matters. */
const BREAKER_PIECES = ["</script", "</SCRIPT ", "<script", "<!--", "-->", "<", ">", "&", "/", '"', "\\"].concat([
  String.fromCharCode(0x2028),
  String.fromCharCode(0x2029),
]);
const breakerString = fc
  .array(fc.oneof(fc.constantFrom(...BREAKER_PIECES), fc.string({ maxLength: 3 })), { maxLength: 8 })
  .map((parts) => parts.join(""));
const value = fc.oneof(
  fc.jsonValue({ stringUnit: "binary", maxDepth: 6 }),
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
      for (const ch of serialiseOrRefused(v) ?? "") {
        expect(BREAKERS.has(ch.codePointAt(0) ?? 0)).toBe(false);
      }
    }),
    { numRuns: 10_000 },
  );
});

type Node = { nodeName: string; childNodes?: Node[]; value?: string };
const scripts = (node: Node): Node[] => [
  ...(node.nodeName === "script" ? [node] : []),
  ...(node.childNodes ?? []).flatMap(scripts),
];

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
