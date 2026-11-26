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

/** What chat-admin may be asked (ADR 0093 decision 5, ADR 0102): fixed, and none of them takes a scope. */
export type ChatAdminVerb =
  | "account.create"
  | "session.mint"
  | "session.end"
  | "account.lock"
  | "account.unlock"
  | "account.deactivate"
  | "rooms.sweep";

/**
 * One chat-admin request. `user` is the chat account's username (the MAS localpart web's mapping holds, never a DID).
 * `rooms.sweep` names no account: its `user` is "" like every field it does not use (ADR 0102 decision 1).
 * `name` is the display name for `account.create` and `device` the device to end for `session.end`. A `session.mint`
 * is web's sign-in ticket (ADR 0093 decision 3): `did` is the member, `sid` names the web session it came from (a
 * one-way reference, never the session's key) and `state` is the one-time value the door set in the browser before
 * the hop, which the door matches before it redeems. Each field is "" for the verbs that do not use it, so every
 * payload has the same keys and the verifier refuses any other.
 */
export type ChatAdminPayload = {
  readonly v: 1;
  readonly env: string;
  readonly aud: "chat-admin";
  readonly verb: ChatAdminVerb;
  readonly user: string;
  readonly name: string;
  readonly device: string;
  readonly did: string;
  readonly sid: string;
  readonly state: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
};

export type AdminEnvelope<P = AdminPayload> = { readonly payload: P; readonly kid: string; readonly sig: string };

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

/** Exactly a chat-admin payload's keys. */
export const CHAT_PAYLOAD_KEYS: readonly (keyof ChatAdminPayload)[] = [
  "v",
  "env",
  "aud",
  "verb",
  "user",
  "name",
  "device",
  "did",
  "sid",
  "state",
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

/** Signs `payload` with the caller's key: the signature is Ed25519 over the canonical bytes, base64url. */
export function signEnvelope<P extends AdminPayload | ChatAdminPayload>(
  payload: P,
  key: { kid: string; privateKey: KeyObject },
): AdminEnvelope<P> {
  const sig = sign(null, Buffer.from(canonicalize(payload)), key.privateKey).toString("base64url");
  return { payload, kid: key.kid, sig };
}
