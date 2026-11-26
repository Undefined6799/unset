// chat-admin's envelope checks (ADR 0093 decision 5), in order: shape, key, signature, the issuer's verbs, claims, then
// each verb's fields, parsed once into branded values. Each refusal carries the status and a reason for the log;
// nothing here touches the disk or the network.
import { type KeyObject, verify } from "node:crypto";
import { CHAT_PAYLOAD_KEYS, type ChatAdminVerb, canonicalize } from "@unset/shared-admin-envelope";

export type Issuer = "web" | "door";
/** A key a caller signs with. The issuer bounds its verbs whatever the key file says: the door only ends sessions. */
export type ServiceKey = {
  readonly kid: string;
  readonly iss: Issuer;
  readonly key: KeyObject;
  readonly verbs: ChatAdminVerb[];
};
export const ISSUER_VERBS: Readonly<Record<Issuer, readonly ChatAdminVerb[]>> = {
  web: [
    "account.create",
    "session.mint",
    "session.end",
    "account.lock",
    "account.unlock",
    "account.deactivate",
    "rooms.sweep",
  ],
  door: ["session.end"],
};
export type Refusal = { readonly status: 400 | 403; readonly reason: string };

/** The chat account's username (MAS localpart), as web's mapping makes it. */
export type ChatUser = string & { readonly __brand: "ChatUser" };
/** A Matrix device ID: 10 of A-Z0-9 (MAS 1.26.0 docs/reference/scopes.md allows a-z, A-Z, 0-9, -, at least 10). */
export type DeviceId = string & { readonly __brand: "DeviceId" };
export type DisplayName = string & { readonly __brand: "DisplayName" };

type Claims = { readonly kid: string; readonly jti: string; readonly exp: number; readonly user: ChatUser };
export type Command = Claims &
  (
    | { readonly verb: "account.create"; readonly name: DisplayName }
    | { readonly verb: "session.mint" }
    | { readonly verb: "session.end"; readonly device: DeviceId }
    | { readonly verb: AccountVerb }
    | { readonly verb: "rooms.sweep" }
  );
/** The account calls of ADR 0096: they name the user and nothing else. */
export type AccountVerb = "account.lock" | "account.unlock" | "account.deactivate";
const ACCOUNT_VERBS: readonly ChatAdminVerb[] = ["account.lock", "account.unlock", "account.deactivate"];

const MAX_LIFETIME = 60;
const CLOCK_SKEW = 5;
const USER = /^[a-z0-9]{12,64}$/;
export const DEVICE = /^[A-Z0-9]{10}$/;
/** A verified handle: a lower-case domain name. */
const HANDLE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SIG = /^[A-Za-z0-9_-]{1,128}$/;
/** A ticket's member (did:plc or did:web), web-session reference and one-time value (ADR 0093 decision 3). chat-admin
 * only checks their form: the door matches `state` against its cookie and keeps `did` and `sid` in its browser list. */
const DID = /^did:(?:plc|web):[A-Za-z0-9._:%-]{1,256}$/;
const TOKEN43 = /^[A-Za-z0-9_-]{43}$/;

type Shaped = { kid: string; sig: string; payload: Record<string, string | number> };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sameKeys = (object: object, keys: readonly string[]) =>
  Object.keys(object).sort().join() === [...keys].sort().join();

/** `kid`, `sig` and a payload of exactly the listed keys, each a string or a safe integer. */
export function checkShape(body: unknown): Shaped | Refusal {
  const bad: Refusal = { status: 400, reason: "shape" };
  if (!isRecord(body) || !sameKeys(body, ["kid", "payload", "sig"])) return bad;
  const { kid, sig, payload } = body;
  if (typeof kid !== "string" || kid.length === 0 || kid.length > 64) return bad;
  if (typeof sig !== "string" || !SIG.test(sig)) return bad;
  if (!isRecord(payload) || !sameKeys(payload, CHAT_PAYLOAD_KEYS)) return bad;
  for (const value of Object.values(payload)) {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) return bad;
  }
  return { kid, sig, payload: payload as Record<string, string | number> };
}

/** Key, signature, verb, claims, then the verb's fields. */
export function checkEnvelope(
  envelope: Shaped,
  keys: readonly ServiceKey[],
  env: string,
  now: number,
): Command | Refusal {
  const { kid, sig, payload: p } = envelope;
  const key = keys.find((k) => k.kid === kid);
  if (key === undefined) return { status: 403, reason: "unknown_kid" };
  // The signature first, so no claim is read before the key has vouched for the whole payload.
  if (!verify(null, Buffer.from(canonicalize(p)), key.key, Buffer.from(sig, "base64url"))) {
    return { status: 403, reason: "signature" };
  }
  const verb = p.verb as ChatAdminVerb;
  if (!key.verbs.includes(verb) || !ISSUER_VERBS[key.iss].includes(verb)) return { status: 403, reason: "verb" };
  if (p.v !== 1 || p.aud !== "chat-admin" || p.env !== env) return { status: 403, reason: "claims" };
  if (typeof p.iat !== "number" || typeof p.exp !== "number") return { status: 403, reason: "claims" };
  if (p.exp - p.iat > MAX_LIFETIME || p.iat > now + CLOCK_SKEW || now > p.exp) return { status: 403, reason: "time" };
  if (typeof p.jti !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(p.jti)) return { status: 400, reason: "jti" };
  // The sweep names no account (ADR 0102 decision 1); every other verb names exactly one.
  const userOk = verb === "rooms.sweep" ? p.user === "" : typeof p.user === "string" && USER.test(p.user);
  if (!userOk) return { status: 400, reason: "user" };
  const claims: Claims = { kid, jti: p.jti, exp: p.exp, user: String(p.user) as ChatUser };
  return fieldsFor(verb, claims, p);
}

const empty = (p: Record<string, string | number>, keys: readonly string[]) => keys.every((key) => p[key] === "");
const TICKET_KEYS = ["did", "sid", "state"] as const;

/** Each verb's own fields; every other field must be "" so a payload cannot carry a value its verb ignores. */
function fieldsFor(verb: ChatAdminVerb, claims: Claims, p: Record<string, string | number>): Command | Refusal {
  const bad: Refusal = { status: 400, reason: "fields" };
  const name = String(p.name);
  const device = String(p.device);
  if (verb === "account.create") {
    return HANDLE.test(name) && empty(p, ["device", ...TICKET_KEYS])
      ? { ...claims, verb, name: name as DisplayName }
      : bad;
  }
  if (verb === "session.end") {
    return DEVICE.test(device) && empty(p, ["name", ...TICKET_KEYS])
      ? { ...claims, verb, device: device as DeviceId }
      : bad;
  }
  if (verb === "rooms.sweep") return empty(p, ["name", "device", ...TICKET_KEYS]) ? { ...claims, verb } : bad;
  if (ACCOUNT_VERBS.includes(verb)) {
    return empty(p, ["name", "device", ...TICKET_KEYS]) ? { ...claims, verb: verb as AccountVerb } : bad;
  }
  const ticket = DID.test(String(p.did)) && TOKEN43.test(String(p.sid)) && TOKEN43.test(String(p.state));
  return ticket && empty(p, ["name", "device"]) ? { ...claims, verb } : bad;
}

export const isRefusal = (value: object): value is Refusal => "status" in value && "reason" in value;
