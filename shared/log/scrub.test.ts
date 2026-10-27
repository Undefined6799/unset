// Value scrubbing (P1.03; rule SE-7), split from logger.test.ts (P1.37o N2) with no test changed.
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { scrub } from "./index.ts";
import { EMAIL } from "./scrub.ts";

describe("logger", () => {
  test.each([
    ["ipv4", "from 10.0.0.1 today"],
    ["ipv6 with zone", "peer 2001:db8::1%eth0"],
    ["ipv6 compressed", "::1"],
    ["email", "mail a@b.c now"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
    ["bearer", "Bearer abc"],
    ["hex run", "f".repeat(64)],
    ["base64url run", "Ab-_".repeat(10)],
    ["did:key", `did:key:z${"6Mk".repeat(15)}`],
  ])("logger_scrubs_values %s", (_kind, value) => {
    // scrub guards stack frame paths and free string fields; the word fields refuse these values whole (P1.03w).
    const out = scrub(value);
    expect(out).toContain("[redacted]");
    const secretPart = value.replace(/^(from|peer|mail|Bearer) /, "").replace(/ (today|now)$/, "");
    expect(out).not.toContain(secretPart);
  });

  // A DID's identifier, kept out of the table so the table holds no parenthesis (compliance.ts finds .each by it).
  const ID = "a".repeat(24);
  const ENCODED_ID = "%61".repeat(24);
  test.each([
    ["percent-encoded", `did%3Aplc%3A${ID}`, "[redacted]"],
    ["lower-case hex", `did%3aplc%3a${ID}`, "[redacted]"],
    ["upper-case letters", "DID:PLC:AAAAAAAAAAAAAAAAAAAAAAAA", "[redacted]"],
    ["double-encoded", `did%253Aplc%253A${ID}`, "[redacted]"],
    ["inside a path", `/did%3Aplc%3A${ID}/x`, "/[redacted]/x"],
    ["mixed separators", `did:plc%3A${ID}`, "[redacted]"],
    ["encoded identifier", `did%3Aplc%3A${ENCODED_ID}`, "[redacted]"],
    ["before IPv6", "did:plc:aaaa::1", "[redacted]"],
    ["numeric method", "did:v1:alice", "[redacted]"],
    ["numeric method, encoded", "did%3Av1%3Aalice", "[redacted]"],
    ["numeric method, double-encoded", "did%253Av1%253Aalice", "[redacted]"],
    ["all-digit method", "did%3A3%3Aalice", "[redacted]"],
    ["inside an encoded query", `/login?next=%2Fdid%3Aplc%3A${ID}`, "/login?next=%2F[redacted]"],
    ["after an encoded quote", `%22did:plc:${ID}`, "%22[redacted]"],
    ["after an encoded space", `%20did:plc:${ID}`, "%20[redacted]"],
    ["after a word character", `user_did%3Aplc%3A${ID}`, "user_[redacted]"],
    ["percent-encoded did:web", "did%3Aweb%3Aexample.com", "[redacted]"],
  ])("logger_scrubs_encoded_dids %s", (_kind, value, scrubbed) => {
    // A client may send a DID's colons percent-encoded, in either hex case (RFC 3986 2.1), or encoded twice. A method
    // may hold digits, or be only digits (W3C did-core method-char). `alice` and `3:alice` are obvious placeholders
    // that fail Veres One and did:3 syntax, and `aaaa::1` fails did:plc syntax, so none can name anyone (SE-7a).
    expect(scrub(value)).toBe(scrubbed);
  });

  test.each([
    ["a word", "didn't"],
    ["no method", "did: then"],
    ["an empty method", "did:%3Aplc"],
    ["no identifier", "did:3:"],
  ])("logger_keeps_did_lookalikes %s", (_kind, value) => {
    // The pattern still needs a method and an identifier after the separators.
    expect(scrub(value)).toBe(value);
  });

  test("logger_redacts_did_inside_a_word", () => {
    // The pattern has no word boundary, so it also matches after `%22` or `_`; a word ending in "did" followed by
    // two colon parts is redacted too, the cost architecture accepted for failing closed (07:11Z).
    expect(scrub("candid:camera:roll")).toBe("can[redacted]");
  });

  test("logger_truncates_and_strips_control_characters", () => {
    const reason = scrub(`a\nb\u0000c\u0085d${"x ".repeat(200)}`);
    expect(reason.startsWith("a?b?c?d")).toBe(true);
    expect(reason.length).toBe(200);
  });
});

describe("email scrub", () => {
  // The pattern before P1.37o: equivalent output, but it retried at every position of a run with no @ (verify-1088 O1).
  const BEFORE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
  const text = fc.string({ unit: fc.constantFrom("a", "b", "aa", ".", "..", "@", " ", "  "), maxLength: 40 });

  test("email_scrub_matches_the_old_pattern", () => {
    fc.assert(
      fc.property(text, (value) => {
        expect(value.replace(EMAIL, "[redacted]")).toBe(value.replace(BEFORE, "[redacted]"));
      }),
      { numRuns: 5_000 },
    );
  });

  test("email_scrub_finishes_a_long_run_without_at", () => {
    // Uncapped on purpose: scrub() cuts its input to 1,000 characters, so only the bare pattern shows the cost.
    const value = "a.".repeat(50_000);
    expect(value.replace(EMAIL, "[redacted]")).toBe(value);
  });
});
