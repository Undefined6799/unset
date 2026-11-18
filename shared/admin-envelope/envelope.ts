// The admin envelope (P2.09; ADR 0060 decision 3). web signs one with its Ed25519 key; pds-admin checks every field
// before it acts. The payload is flat, holding only strings and safe integers, so its canonical form is RFC 8785 JCS
// reduced to sorted keys and JSON.stringify: no floats, no nesting, no number formatting to agree on.
import { type KeyObject, sign } from "node:crypto";

/** One admin request: who asks (`actor_did`), for whom (`target`), what (`verb`), for which service and for how long. */
export type AdminPayload = {
  readonly v: 1;
  readonly env: string;
  readonly aud: "pds-admin";
  readonly pds_did: string;
  readonly verb: "invite.issue";
  readonly target: string;
  readonly actor_did: string;
  /** base64url of 16 random bytes; pds-admin accepts each once. */
  readonly jti: string;
  /** Seconds since the epoch. */
  readonly iat: number;
  readonly exp: number;
};

export type AdminEnvelope = { readonly payload: AdminPayload; readonly kid: string; readonly sig: string };

/** Exactly the payload's keys: the verifier refuses any other key or a missing one. */
export const PAYLOAD_KEYS: readonly (keyof AdminPayload)[] = [
  "v",
  "env",
  "aud",
  "pds_did",
  "verb",
  "target",
  "actor_did",
  "jti",
  "iat",
  "exp",
];

/** The canonical bytes of a flat object of strings and safe integers; anything else is a programming error. */
export function canonicalize(object: Readonly<Record<string, string | number>>): string {
  const keys = Object.keys(object).sort();
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))) continue;
    throw new TypeError("an envelope value must be a string or a safe integer");
  }
  return `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(object[key])}`).join(",")}}`;
}

/** Signs `payload` with web's key: the signature is Ed25519 over the canonical bytes, base64url. */
export function signEnvelope(payload: AdminPayload, key: { kid: string; privateKey: KeyObject }): AdminEnvelope {
  const sig = sign(null, Buffer.from(canonicalize(payload)), key.privateKey).toString("base64url");
  return { payload, kid: key.kid, sig };
}
