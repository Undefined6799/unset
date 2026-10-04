// Property tests for serializeProps (P1.10): any JSON value survives the trip through an inline script element.
import fc from "fast-check";
import { parse } from "parse5";
import { expect, test } from "vitest";
import { serializeProps } from "./props.ts";

const BREAKERS = new Set([0x3c, 0x3e, 0x26, 0x2028, 0x2029]);
const value = fc.jsonValue({ stringUnit: "binary", maxDepth: 6 });
/** JSON has no negative zero: it serialises as `0`, so compare with it normalised. */
const normalise = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

test("fuzz_roundtrip", () => {
  fc.assert(
    fc.property(value, (v) => {
      expect(JSON.parse(serializeProps(v as never, { maxBytes: 1e9 }))).toEqual(normalise(v));
    }),
    { numRuns: 10_000 },
  );
});

test("fuzz_no_breakers", () => {
  fc.assert(
    fc.property(value, (v) => {
      for (const ch of serializeProps(v as never, { maxBytes: 1e9 })) {
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
      const json = serializeProps(v as never, { maxBytes: 1e9 });
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
