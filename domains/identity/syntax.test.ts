import { describe, expect, test } from "vitest";
import { parseDid, parseHandle } from "./index.ts";

describe("parseDid", () => {
  test("accepts_plc_and_web", () => {
    for (const did of [
      "did:plc:eeeeeeeeeeeeeeeeeeeeeeee",
      "did:plc:777777777777777777777777",
      "did:web:example.com",
      "did:web:user.sub.example.com",
    ]) {
      expect(parseDid(did)).toBe(did);
    }
    for (const bad of [
      "",
      "did:plc:eeeeeeeeeeeeeeeeeeeeeee", // 23 characters
      "did:plc:eeeeeeeeeeeeeeeeeeeeeeeee", // 25 characters
      "did:plc:EEEEEEEEEEEEEEEEEEEEEEEE", // DIDs are case-sensitive; upper case is invalid
      "did:plc:eeeeeeeeeeeeeeeeeeeeeee1", // 1 is not base32
      "did:web:localhost",
      "did:web:pds:3000",
      "did:web:pds%3A3000",
      "did:web:10.0.0.1",
      "did:web:a%2Fb",
      "did:web:example.com:path",
      "did:web:Example.com",
      "did:web:laptop.local",
      "did:web:blah.arpa",
      "did:web:example.com.",
      "did:key:zabc", // an unsupported method
      " did:plc:eeeeeeeeeeeeeeeeeeeeeeee",
      "did:plc:eeeeeeeeeeeeeeeeeeeeeeee\n",
      "did:plc:eeeeeeeeeeeeeeeeeeeeeeee#atproto",
    ]) {
      expect(parseDid(bad), bad).toBeNull();
    }
  });
});

describe("parseHandle", () => {
  test("normalises_and_rejects", () => {
    const cases: [string, string | null][] = [
      ["alice.example.com", "alice.example.com"],
      ["example.com", "example.com"],
      // unset.im is our handle domain and the only two-letter TLD a test may use (RFC 2606 and 6761 name none);
      // the one-letter label x is listed for P2.09's reserved handles (P1.35i). ADR 0025.
      ["x.unset.im", "x.unset.im"],
      ["Alice.Example.COM", "alice.example.com"],
      ["@alice.example.com", "alice.example.com"],
      ["  alice.example.com\t", "alice.example.com"],
      ["8.example.org", "8.example.org"],
      ["xn--ls8h.example.org", "xn--ls8h.example.org"],
      ["XX.LCS.EXAMPLE.ORG", "xx.lcs.example.org"],
      ["@@alice.example.com", null], // only one leading @ is stripped
      ["alice..example.com", null],
      ["-a.example.com", null],
      ["a-.example.com", null],
      ["org", null],
      ["name.example.org.", null],
      ["john.0", null],
      ["jo@hn.example.com", null],
      ["💩.example.com", null],
      ["Kelvin.example.com", null], // KELVIN SIGN lowercases to an ASCII k; non-ASCII input is refused first
      ["a.b\u0000.com", null],
      [`${"a".repeat(64)}.com`, null],
    ];
    for (const [raw, expected] of cases) expect(parseHandle(raw), raw).toBe(expected);
    const longest = `${"a.".repeat(121)}example.com`; // 253 characters
    expect(parseHandle(longest)).toBe(longest);
    expect(parseHandle(`a${longest}`)).toBeNull();
  });

  test("rejects_every_disallowed_tld", () => {
    for (const tld of ["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion", "test"]) {
      expect(parseHandle(`alice.${tld}`), tld).toBeNull();
      expect(parseHandle(`alice.${tld.toUpperCase()}`), tld).toBeNull();
    }
  });
});
