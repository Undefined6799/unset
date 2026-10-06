import { describe, expect, test } from "vitest";
import { parseDid, parseHandle } from "./index.ts";

describe("parseDid", () => {
  test("accepts_plc_and_web", () => {
    for (const did of ["did:plc:ewvi7nxzyoun6zhxrhs64oiz", "did:web:example.com", "did:web:user.example.co.uk"]) {
      expect(parseDid(did)).toBe(did);
    }
    for (const bad of [
      "",
      "did:plc:ewvi7nxzyoun6zhxrhs64oi", // 23 characters
      "did:plc:ewvi7nxzyoun6zhxrhs64oizz", // 25 characters
      "did:plc:EWVI7NXZYOUN6ZHXRHS64OIZ", // DIDs are case-sensitive; upper case is invalid
      "did:plc:ewvi7nxzyoun6zhxrhs64oi1", // 1 is not base32
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
      " did:plc:ewvi7nxzyoun6zhxrhs64oiz",
      "did:plc:ewvi7nxzyoun6zhxrhs64oiz\n",
      "did:plc:ewvi7nxzyoun6zhxrhs64oiz#atproto",
    ]) {
      expect(parseDid(bad), bad).toBeNull();
    }
  });
});

describe("parseHandle", () => {
  test("normalises_and_rejects", () => {
    const cases: [string, string | null][] = [
      ["alice.0x40.me", "alice.0x40.me"],
      ["Alice.0x40.ME", "alice.0x40.me"],
      ["@alice.0x40.me", "alice.0x40.me"],
      ["  alice.0x40.me\t", "alice.0x40.me"],
      ["8.cn", "8.cn"],
      ["xn--ls8h.example.org", "xn--ls8h.example.org"],
      ["XX.LCS.MIT.EDU", "xx.lcs.mit.edu"],
      ["@@alice.0x40.me", null], // only one leading @ is stripped
      ["alice..0x40.me", null],
      ["-a.0x40.me", null],
      ["a-.0x40.me", null],
      ["org", null],
      ["name.org.", null],
      ["john.0", null],
      ["jo@hn.example.com", null],
      ["💩.example.com", null],
      ["Kelvin.com", null], // KELVIN SIGN lowercases to an ASCII k; non-ASCII input is refused first
      ["a.b\u0000.com", null],
      [`${"a".repeat(64)}.com`, null],
    ];
    for (const [raw, expected] of cases) expect(parseHandle(raw), raw).toBe(expected);
    const longest = `${"a.".repeat(125)}com`; // 253 characters
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
