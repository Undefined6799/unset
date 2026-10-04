// Property tests for safeReturnPath (P1.09): whatever it returns stays on our origin, also as a browser reads a
// Location header, and returning it again changes nothing.
import fc from "fast-check";
import { expect, test } from "vitest";
import { safeReturnPath } from "./index.ts";

const ORIGIN = "https://app.example";
/** C0, DEL, C1, U+2028, U+2029, U+FEFF: by code point, since these cannot sit in a regex literal. */
const forbidden = (text: string): boolean =>
  [...text].some((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff;
  });
const TAB_CR_LF = /[\t\r\n]/g;

/** Fragments that matter to URL parsers, mixed with random text so the property runs on the dangerous space. */
const ATTACK_FRAGMENTS = [
  "/",
  "//",
  "\\",
  "%2f",
  "%5c",
  "@",
  ":",
  "\t",
  "\r",
  "\n",
  ".",
  "..",
  "javascript:",
  "https://",
];
const fragment = fc.oneof(fc.constantFrom(...ATTACK_FRAGMENTS), fc.string({ unit: "grapheme", maxLength: 6 }));
const candidate = fc.oneof(
  fc.array(fragment, { maxLength: 12 }).map((parts) => parts.join("")),
  fc.array(fragment, { maxLength: 12 }).map((parts) => `/${parts.join("")}`),
  fc.string({ unit: "binary", maxLength: 40 }),
);

const sameOrigin = (path: string): boolean => new URL(path, ORIGIN).origin === ORIGIN;

test("fuzz_same_origin", () => {
  fc.assert(
    fc.property(candidate, (input) => {
      const result = safeReturnPath(input);
      if (result === null) return;
      expect(sameOrigin(result)).toBe(true);
      expect(sameOrigin(result.replace(TAB_CR_LF, ""))).toBe(true);
      expect(forbidden(result)).toBe(false);
      expect(safeReturnPath(result)).toBe(result);
    }),
    { numRuns: 10_000 },
  );
});

test("fuzz_generators_include_attacks", () => {
  // The arbitrary must actually produce the dangerous fragments, or the property above proves little.
  const samples = fc.sample(candidate, { numRuns: 2_000, seed: 42 }).join("\n");
  for (const piece of ["//", "\\", "%2f", "%5c", "javascript:", "https://", "\t", ".."]) {
    expect(samples.includes(piece), JSON.stringify(piece)).toBe(true);
  }
});
