// Property tests for the PDS endpoint a DID document names and for DID syntax (P1.36v, TE-6; verify-1131 N2). Sign-in
// is decided by comparing the PDS origin read here with ours, so nothing but a bare https origin may come out, and no
// string that is not a did:plc or a hostname-only did:web may pass as a DID.
import fc from "fast-check";
import { expect, test } from "vitest";
import { parseDidDoc } from "./did-doc.ts";
import { type Did, parseDid } from "./syntax.ts";

const DID = `did:plc:${"a".repeat(24)}` as Did;
const docWith = (serviceEndpoint: unknown) => ({
  id: DID,
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint }],
});

/** Pieces that matter to URL parsers, mixed with random text so the property runs on the dangerous space. */
const URL_FRAGMENTS = [
  "https://",
  "http://",
  "wss://",
  "//",
  "\\",
  "@",
  ":",
  ":443",
  ":8443",
  "/",
  "?",
  "#",
  ".",
  "%2f",
  "%40",
  "pds.example.com",
  "PDS.Example.COM",
  "[::1]",
  "127.0.0.1",
  "xn--e1a",
  "\t",
  "\n",
  " ",
];
const urlFragment = fc.oneof(fc.constantFrom(...URL_FRAGMENTS), fc.string({ unit: "grapheme", maxLength: 5 }));
const endpoint = fc.oneof(
  fc.array(urlFragment, { maxLength: 10 }).map((parts) => parts.join("")),
  fc.array(urlFragment, { maxLength: 8 }).map((parts) => `https://${parts.join("")}`),
  fc.webUrl({ withQueryParameters: true, withFragments: true }),
);

test("fuzz_pds_endpoint_is_a_bare_https_origin", () => {
  fc.assert(
    fc.property(endpoint, (raw) => {
      const pds = parseDidDoc(docWith(raw), DID)?.pds ?? null;
      if (pds === null) return;
      expect(pds.protocol).toBe("https:");
      expect([pds.username, pds.password, pds.search, pds.hash]).toEqual(["", "", "", ""]);
      expect(pds.pathname).toBe("/");
      // The origin compared with ours is the one the document wrote, not a part of it.
      expect(pds.origin).toBe(new URL(raw).origin);
    }),
    { numRuns: 10_000 },
  );
});

test("fuzz_pds_endpoint_origin_survives_unchanged", () => {
  fc.assert(
    fc.property(fc.domain(), fc.option(fc.integer({ min: 1, max: 65_535 }), { nil: undefined }), (host, port) => {
      const origin = new URL(`https://${host}${port === undefined ? "" : `:${port}`}`).origin;
      expect(parseDidDoc(docWith(origin), DID)?.pds?.origin).toBe(origin);
      for (const tail of ["/xrpc", "?a=1", "#x"]) expect(parseDidDoc(docWith(`${origin}${tail}`), DID)?.pds).toBeNull();
    }),
    { numRuns: 2_000 },
  );
});

const DID_FRAGMENTS = ["did:", "plc:", "web:", "did:plc:", "did:web:", "a", "z", "2", "7", "8", ".", ":", "%3A", "/"];
const didCandidate = fc.oneof(
  fc
    .array(fc.oneof(fc.constantFrom(...DID_FRAGMENTS), fc.string({ maxLength: 4 })), { maxLength: 12 })
    .map((p) => p.join("")),
  fc
    .string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz234567"), minLength: 20, maxLength: 28 })
    .map((s) => `did:plc:${s}`),
  fc.domain().map((host) => `did:web:${host}`),
);

test("fuzz_parse_did_accepts_only_plc_or_hostname_web", () => {
  fc.assert(
    fc.property(didCandidate, (raw) => {
      const did = parseDid(raw);
      if (did === null) return;
      expect(did).toBe(raw);
      expect(/^did:plc:[a-z2-7]{24}$/.test(did) || /^did:web:[a-z0-9.-]+$/.test(did), did).toBe(true);
    }),
    { numRuns: 10_000 },
  );
});

test("fuzz_parse_did_accepts_every_plc", () => {
  const plc = fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz234567"), minLength: 24, maxLength: 24 });
  fc.assert(
    fc.property(plc, (id) => {
      expect(parseDid(`did:plc:${id}`)).toBe(`did:plc:${id}`);
    }),
  );
});
