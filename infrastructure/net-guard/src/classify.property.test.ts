// Property tests for the classifier (rule TE-6, architecture ruling 2026-10-04). The exhaustive sweep in
// review.test.ts covers well-formed addresses; these feed the unusual spellings SSRF bypasses use.
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { classifyAddress } from "./classify.ts";

const octet = fc.integer({ min: 0, max: 255 });
const ipv4 = fc.tuple(octet, octet, octet, octet);
const dotted = (o: readonly number[]): string => o.join(".");
const hex16 = (hi: number, lo: number): string => ((hi << 8) | lo).toString(16);

/** An IPv4 address in a range that must never be public: loopback, private, link-local, CGNAT, unspecified. */
const internalIpv4 = fc.oneof(
  fc.tuple(fc.constant(127), octet, octet, octet),
  fc.tuple(fc.constant(10), octet, octet, octet),
  fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), octet, octet),
  fc.tuple(fc.constant(192), fc.constant(168), octet, octet),
  fc.tuple(fc.constant(169), fc.constant(254), octet, octet),
  fc.tuple(fc.constant(100), fc.integer({ min: 64, max: 127 }), octet, octet),
  fc.tuple(fc.constant(0), octet, octet, octet),
);

/** Spellings inet_aton accepts but that are not dotted-quad literals: octal, hex, integer and short forms. */
function legacySpellings([a, b, c, d]: readonly number[]): string[] {
  const n = (((a ?? 0) << 24) >>> 0) + ((b ?? 0) << 16) + ((c ?? 0) << 8) + (d ?? 0);
  return [
    [a, b, c, d].map((o) => `0${(o ?? 0).toString(8)}`).join("."),
    [a, b, c, d].map((o) => `0x${(o ?? 0).toString(16)}`).join("."),
    String(n),
    `0x${n.toString(16)}`,
    `${a}.${((b ?? 0) << 16) + ((c ?? 0) << 8) + (d ?? 0)}`,
    `${a}.${b}.${((c ?? 0) << 8) + (d ?? 0)}`,
  ];
}

describe("classifier properties", () => {
  test("embedded_ipv4_forms_match_ipv4", () => {
    fc.assert(
      fc.property(ipv4, (o) => {
        const [a = 0, b = 0, c = 0, d = 0] = o;
        const expected = classifyAddress(dotted(o));
        const forms = [
          `::ffff:${dotted(o)}`,
          `::ffff:${hex16(a, b)}:${hex16(c, d)}`,
          `0:0:0:0:0:ffff:${dotted(o)}`,
          `[::ffff:${dotted(o)}]`,
          `64:ff9b::${dotted(o)}`,
          `64:ff9b::${hex16(a, b)}:${hex16(c, d)}`,
        ];
        for (const form of forms) expect(classifyAddress(form), form).toBe(expected);
      }),
    );
  });

  test("legacy_ipv4_spellings_are_never_public", () => {
    fc.assert(
      fc.property(fc.oneof(ipv4, internalIpv4), (o) => {
        for (const spelling of legacySpellings(o)) {
          if (spelling === dotted(o)) continue;
          expect(classifyAddress(spelling), spelling).not.toBe("public");
        }
      }),
    );
  });

  test("internal_ipv4_is_never_public_in_any_form", () => {
    fc.assert(
      fc.property(internalIpv4, fc.constantFrom("", ".", "..", " ", "\t"), (o, tail) => {
        const [a = 0, b = 0, c = 0, d = 0] = o;
        for (const form of [dotted(o), `::ffff:${dotted(o)}`, `::ffff:${hex16(a, b)}:${hex16(c, d)}`]) {
          expect(classifyAddress(`${form}${tail}`), JSON.stringify(form + tail)).not.toBe("public");
          expect(classifyAddress(form.toUpperCase()), form).not.toBe("public");
        }
      }),
    );
  });

  test("compressed_and_expanded_ipv6_agree", () => {
    const group = fc.integer({ min: 0, max: 0xffff });
    fc.assert(
      fc.property(fc.array(group, { minLength: 8, maxLength: 8 }), fc.integer({ min: 0, max: 7 }), (groups, start) => {
        const zeroed = groups.map((g, i) => (i >= start && i < start + 2 ? 0 : g));
        const full = zeroed.map((g) => g.toString(16)).join(":");
        const padded = zeroed.map((g) => g.toString(16).padStart(4, "0")).join(":");
        expect(classifyAddress(padded), padded).toBe(classifyAddress(full));
        expect(classifyAddress(full.toUpperCase()), full).toBe(classifyAddress(full));
      }),
    );
  });

  test("zone_ids_never_hide_a_non_public_address", () => {
    const zone = fc.stringMatching(/^[a-z0-9.]{1,8}$/);
    const nonPublic = fc.constantFrom("fe80::1", "fe80::abcd:1", "::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1");
    fc.assert(
      fc.property(nonPublic, zone, (address, id) => {
        expect(classifyAddress(`${address}%${id}`), `${address}%${id}`).not.toBe("public");
        expect(classifyAddress(`[${address}%25${id}]`), `[${address}%25${id}]`).not.toBe("public");
      }),
    );
  });

  test("arbitrary_text_is_public_only_when_it_is_an_ip", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 48 }), (text) => {
        if (classifyAddress(text) !== "public") return;
        expect(/^[\[\]0-9a-fA-F:.]+$/.test(text.replace(/\.+$/, "")), JSON.stringify(text)).toBe(true);
      }),
    );
  });
});
