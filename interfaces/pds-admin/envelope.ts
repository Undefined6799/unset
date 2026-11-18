// Envelope checks (P2.09 steps 3 to 6; ADR 0060 decision 3), in order: shape, key, signature, claims. Each refusal
// carries the status to answer and a reason for the log; nothing here touches the disk or the network.
import { type KeyObject, verify } from "node:crypto";
import { type AdminPayload, canonicalize, PAYLOAD_KEYS } from "@unset/shared-admin-envelope";

/** A key `web` may sign with: one kid, issuer `web`, an Ed25519 public key and the verbs it may ask for. */
export type ServiceKey = {
  readonly kid: string;
  readonly iss: "web";
  readonly key: KeyObject;
  readonly verbs: string[];
};
export type Refusal = { readonly status: 400 | 403; readonly reason: string };
export type Expected = { readonly env: string; readonly pdsDid: string };

/** The longest an envelope may live, and how far ahead of our clock its `iat` may be (seconds). */
const MAX_LIFETIME = 60;
const CLOCK_SKEW = 5;
const DID = /^did:(plc|web):[A-Za-z0-9._:%-]{1,256}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

type Shaped = { kid: string; sig: string; payload: Record<string, string | number> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Step 3: `kid`, `sig` and a payload of exactly the listed keys, each a string or a safe integer. */
export function checkShape(body: unknown): Shaped | Refusal {
  const bad: Refusal = { status: 400, reason: "shape" };
  if (!isRecord(body) || Object.keys(body).sort().join() !== "kid,payload,sig") return bad;
  const { kid, sig, payload } = body;
  if (typeof kid !== "string" || kid.length === 0 || kid.length > 64) return bad;
  if (typeof sig !== "string" || !BASE64URL.test(sig) || sig.length > 128) return bad;
  if (!isRecord(payload) || Object.keys(payload).sort().join() !== [...PAYLOAD_KEYS].sort().join()) return bad;
  for (const value of Object.values(payload)) {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) return bad;
  }
  return { kid, sig, payload: payload as Record<string, string | number> };
}

/** Steps 4 to 6: a known key, a valid signature, the key's verb and self-only issuing, then every claim. */
export function checkEnvelope(
  envelope: Shaped,
  keys: readonly ServiceKey[],
  expected: Expected,
  now: number,
): AdminPayload | Refusal {
  const { kid, sig, payload: p } = envelope;
  const key = keys.find((k) => k.kid === kid);
  if (key === undefined) return { status: 403, reason: "unknown_kid" };
  // The signature first, so no claim is read before the key has vouched for the whole payload.
  if (!verify(null, Buffer.from(canonicalize(p)), key.key, Buffer.from(sig, "base64url"))) {
    return { status: 403, reason: "signature" };
  }
  if (typeof p.verb !== "string" || !key.verbs.includes(p.verb)) return { status: 403, reason: "verb" };
  if (key.iss !== "web" || p.actor_did !== p.target) return { status: 403, reason: "actor_not_target" };
  if (p.aud !== "pds-admin" || p.env !== expected.env || p.pds_did !== expected.pdsDid || p.v !== 1) {
    return { status: 403, reason: "claims" };
  }
  if (typeof p.iat !== "number" || typeof p.exp !== "number") return { status: 403, reason: "claims" };
  if (p.exp - p.iat > MAX_LIFETIME || p.iat > now + CLOCK_SKEW || now > p.exp) return { status: 403, reason: "time" };
  if (typeof p.target !== "string" || !DID.test(p.target)) return { status: 400, reason: "did" };
  if (typeof p.jti !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(p.jti)) return { status: 400, reason: "jti" };
  return p as unknown as AdminPayload;
}

export const isRefusal = (value: object): value is Refusal => "status" in value && "reason" in value;
