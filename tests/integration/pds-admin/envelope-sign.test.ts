import { generateKeyPairSync, verify } from "node:crypto";
import { type AdminPayload, canonicalize, PAYLOAD_KEYS, signEnvelope } from "@unset/shared-admin-envelope";
import { describe, expect, test } from "vitest";

const payload: AdminPayload = {
  v: 1,
  env: "dev",
  aud: "pds-admin",
  pds_did: "did:web:pds.example",
  verb: "invite.issue",
  target: "did:plc:abc",
  actor_did: "did:plc:abc",
  jti: "AAAAAAAAAAAAAAAAAAAAAA",
  iat: 1_800_000_000,
  exp: 1_800_000_060,
};

describe("canonicalize", () => {
  test("sorts keys and keeps strings and integers exactly (JCS for flat objects)", () => {
    expect(canonicalize({ b: "x", a: 2, c: 'q" ' })).toBe('{"a":2,"b":"x","c":"q\\" "}');
  });

  test("refuses a float, a nested object or an unsafe integer", () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow(TypeError);
    expect(() => canonicalize({ a: { b: 1 } } as never)).toThrow(TypeError);
    expect(() => canonicalize({ a: 2 ** 53 })).toThrow(TypeError);
  });

  test("the payload keys are the ten the verifier requires", () => {
    expect([...PAYLOAD_KEYS].sort()).toEqual(Object.keys(payload).sort());
  });
});

describe("signEnvelope", () => {
  test("signs the canonical bytes with Ed25519 under the given key id", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const envelope = signEnvelope(payload, { kid: "web-1", privateKey });
    expect(envelope.kid).toBe("web-1");
    expect(envelope.payload).toEqual(payload);
    const signature = Buffer.from(envelope.sig, "base64url");
    expect(verify(null, Buffer.from(canonicalize(payload)), publicKey, signature)).toBe(true);
  });
});
