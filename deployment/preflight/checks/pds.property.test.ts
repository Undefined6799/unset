// Property tests for fromAddressProblem (P1.36g, TE-6): whatever it accepts is one bare address within RFC 5321's
// length caps, with nothing a mail header could split on; and every dot-atom address within those caps is accepted.
import fc from "fast-check";
import { expect, test } from "vitest";
import { fromAddressProblem } from "./pds.ts";

/** Fragments that matter to a From header, mixed with random text so the property runs on the dangerous space. */
const ATTACK_FRAGMENTS = ["@", ".", "-", "_", ",", ";", "<", ">", '"', " ", "\t", "\r", "\n", "\r\nBcc: ", "a", "z9"];
const fragment = fc.oneof(fc.constantFrom(...ATTACK_FRAGMENTS), fc.string({ unit: "grapheme", maxLength: 4 }));
const atext = fc.constantFrom(..."abcXYZ019!#$%&'*+/=?^_`{|}~-");
const atom = fc.string({ unit: atext, minLength: 1, maxLength: 12 });
const ldh = fc.constantFrom(..."abz09-");
const alnum = fc.constantFrom(..."abz09");
const label = fc
  .tuple(alnum, fc.string({ unit: ldh, maxLength: 20 }), alnum)
  .map(([first, middle, last]) => `${first}${middle}${last}`);
const address = fc
  .tuple(fc.array(atom, { minLength: 1, maxLength: 4 }), fc.array(label, { minLength: 2, maxLength: 4 }))
  .map(([local, domain]) => `${local.join(".")}@${domain.join(".")}`);

/** Valid addresses with a fragment spliced in, or a long local part, so accepted inputs are common, not rare. */
const candidate = fc.oneof(
  fc.array(fragment, { maxLength: 16 }).map((parts) => parts.join("")),
  fc.string({ unit: "binary", maxLength: 300 }),
  fc
    .tuple(address, fragment, fc.nat())
    .map(
      ([text, piece, at]) => `${text.slice(0, at % (text.length + 1))}${piece}${text.slice(at % (text.length + 1))}`,
    ),
  fc.tuple(fc.string({ unit: atext, minLength: 60, maxLength: 70 }), address).map(([local, text]) => `${local}${text}`),
);

test("fuzz_accepted_from_address_is_one_bare_address", () => {
  fc.assert(
    fc.property(candidate, (input) => {
      if (fromAddressProblem(input, "K") !== null) return;
      const [local = "", ...rest] = input.split("@");
      expect(rest).toHaveLength(1);
      expect(input.length).toBeLessThanOrEqual(254);
      expect(local.length).toBeLessThanOrEqual(64);
      // Visible ASCII only (no space, control character or DEL), and none of the header list and quote characters.
      expect(
        [...input].every((c) => c > " " && c <= "~"),
        JSON.stringify(input),
      ).toBe(true);
      expect(input).not.toMatch(/[,;<>"]/);
    }),
    { numRuns: 10_000 },
  );
});

test("fuzz_dot_atom_address_within_caps_is_accepted", () => {
  fc.assert(
    fc.property(address, (input) => {
      const within = input.length <= 254 && (input.split("@")[0] ?? "").length <= 64;
      expect(fromAddressProblem(input, "K")).toBe(within ? null : "K is not an email address");
    }),
    { numRuns: 2_000 },
  );
});
