// P1.35p S1: the strict DER walk C18 uses on the dev root, one red case per rule, and a fuzz run that only ever ends in
// a list of extensions or a DerError.
import { describe, expect, test } from "vitest";
import { certificateExtensions, DerError, der } from "./der.ts";

const hex = (text: string) => Buffer.from(text, "hex");
const SEQ = 0x30;
const extension = (oid: string, value: string, critical?: string) =>
  der(SEQ, der(0x06, hex(oid)), ...(critical === undefined ? [] : [der(0x01, hex(critical))]), der(0x04, hex(value)));
const BASIC = extension("551d13", "30060101ff020100", "ff");
const USAGE = extension("551d0f", "03020106");
/** A certificate's shape: version, serial, signature, issuer, validity, subject, key, then the extensions given. */
const certificate = (tail: Buffer[], after: Buffer[] = []) =>
  der(
    SEQ,
    der(
      SEQ,
      der(0xa0, der(0x02, hex("02"))),
      der(0x02, hex("01")),
      der(SEQ),
      der(SEQ),
      der(SEQ),
      der(SEQ, der(0x31, der(SEQ, der(0x06, hex("550403")), der(0x0c, Buffer.from("root"))))),
      der(SEQ),
      ...tail,
    ),
    der(SEQ, der(0x06, hex("2a8648ce3d040302"))),
    der(0x03, hex("00")),
    ...after,
  );
const extensions = (...list: Buffer[]) => der(0xa3, der(SEQ, ...list));
const GOOD = certificate([extensions(BASIC, USAGE)]);

describe("der", () => {
  test("der_reads_each_extension_in_order", () => {
    expect(certificateExtensions(GOOD)).toEqual([
      { oid: "551d13", critical: true, value: hex("30060101ff020100") },
      { oid: "551d0f", critical: false, value: hex("03020106") },
    ]);
    expect(certificateExtensions(certificate([]))).toEqual([]);
    // A length of 128 or more takes the long form, and that is DER.
    const big = extension("2a0304", "00".repeat(200));
    expect(certificateExtensions(certificate([extensions(big)]))[0]?.value).toHaveLength(200);
  });

  test("der_refuses_what_is_not_der", () => {
    // GOOD is under 128 octets, so its length takes the short form; BIG is over 255, so two length octets.
    const BIG = certificate([extensions(extension("2a0304", "00".repeat(300)))]);
    const short = "length not in its shortest form";
    const refused: [string, Buffer, string][] = [
      ["trailing octets after the certificate", Buffer.concat([GOOD, hex("0000")]), "not one element"],
      ["an indefinite length", Buffer.concat([hex("3080"), GOOD.subarray(2), hex("0000")]), "indefinite length"],
      ["a long form where the short form fits", Buffer.concat([hex("3081"), GOOD.subarray(1)]), short],
      ["a length with a leading zero octet", Buffer.concat([hex("308300"), BIG.subarray(2)]), short],
      ["a high tag number", Buffer.concat([hex("1f"), GOOD.subarray(1)]), "high tag number"],
      ["a truncated certificate", GOOD.subarray(0, GOOD.length - 1), "truncated"],
      ["nothing at all", Buffer.alloc(0), "not one element"],
      ["critical written as FALSE", certificate([extensions(extension("551d0f", "03020106", "00"))]), "not DER's TRUE"],
      [
        "critical as another true value",
        certificate([extensions(extension("551d0f", "03020106", "01"))]),
        "not DER's TRUE",
      ],
      ["extensions before another field", certificate([extensions(BASIC), der(0x82, hex("00"))]), "not the last"],
      ["a field after the signature", certificate([extensions(BASIC)], [der(0x05)]), "not a certificate"],
      ["an extension that is not a SEQUENCE", certificate([der(0xa3, der(SEQ, der(0x31)))]), "not an extension"],
      [
        "an extension without its value",
        certificate([extensions(der(SEQ, der(0x06, hex("551d0f"))))]),
        "not an extension",
      ],
      [
        "two SEQUENCEs in the extensions field",
        certificate([der(0xa3, der(SEQ, BASIC), der(SEQ, USAGE))]),
        "not one element",
      ],
    ];
    expect(BIG.subarray(0, 2)).toEqual(hex("3082"));
    for (const [what, bytes, message] of refused) {
      expect(() => certificateExtensions(bytes), what).toThrow(message);
      expect(() => certificateExtensions(bytes), what).toThrow(DerError);
    }
    // A non-DER length deep in a field nothing else reads still refuses: the whole certificate is walked.
    const subject = der(SEQ, Buffer.concat([hex("3181"), hex("05"), der(SEQ, der(0x05))]));
    expect(() => certificateExtensions(certificate([subject, extensions(BASIC)]))).toThrow(short);
  });

  test("der_fuzz_ends_in_extensions_or_a_der_error", () => {
    // A fixed-seed generator (mulberry32), so a failure replays; each mutant flips, inserts or deletes one octet.
    let seed = 0x35f0;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const octet = () => Math.floor(next() * 256);
    let refused = 0;
    for (let round = 0; round < 5000; round++) {
      const at = Math.floor(next() * GOOD.length);
      const kind = Math.floor(next() * 3);
      const mutant =
        kind === 0
          ? Buffer.concat([GOOD.subarray(0, at), Buffer.from([octet()]), GOOD.subarray(at + 1)])
          : kind === 1
            ? Buffer.concat([GOOD.subarray(0, at), Buffer.from([octet()]), GOOD.subarray(at)])
            : Buffer.concat([GOOD.subarray(0, at), GOOD.subarray(at + 1)]);
      try {
        certificateExtensions(mutant);
      } catch (error) {
        expect(error, `round ${round}`).toBeInstanceOf(DerError);
        refused++;
      }
    }
    // Every insertion and deletion changes a length somewhere, so most mutants refuse.
    expect(refused).toBeGreaterThan(2500);
  });
});
