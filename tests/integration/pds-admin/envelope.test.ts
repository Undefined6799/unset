import { randomBytes, randomInt } from "node:crypto";
import { describe, expect, test } from "vitest";
import { checkEnvelope, checkShape, isRefusal } from "../../../interfaces/pds-admin/envelope.ts";
import { nowSeconds, PDS_DID, payloadFor, signed, webKey } from "./harness.ts";

describe("checkEnvelope", () => {
  test("envelope.jcs_roundtrip: web's signer and pds-admin's verifier agree on 20 random payloads", () => {
    const key = webKey();
    for (let i = 0; i < 20; i++) {
      const did = `did:plc:${randomBytes(12).toString("hex")}`;
      const env = `e${randomBytes(randomInt(1, 8)).toString("base64url")}é"\\`;
      const payload = payloadFor({ target: did, actor_did: did, env, iat: nowSeconds() - randomInt(0, 30) });
      const wire = JSON.parse(JSON.stringify(signed(key, { ...payload, exp: payload.iat + 60 })));
      const shaped = checkShape(wire);
      expect(isRefusal(shaped)).toBe(false);
      if (isRefusal(shaped)) return;
      expect(checkEnvelope(shaped, [key.service], { env, pdsDid: PDS_DID }, nowSeconds())).toEqual({
        ...payload,
        exp: payload.iat + 60,
      });
    }
  });

  test("a jti that is not 16 bytes of base64url is refused", () => {
    const key = webKey();
    const shaped = checkShape(signed(key, payloadFor({ jti: "short" })));
    if (isRefusal(shaped)) throw new Error("shape");
    expect(checkEnvelope(shaped, [key.service], { env: "dev", pdsDid: PDS_DID }, nowSeconds())).toEqual({
      status: 400,
      reason: "jti",
    });
  });
});
