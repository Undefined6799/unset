// One call to chat-admin (ADR 0081 decision 5), shared by web's client and the door's: a payload signed with the
// caller's own Ed25519 key, with the claims every verb carries (a fresh jti, 60 seconds of life), and a POST through
// net-guard's chat-admin policy whose answer is its status and JSON object, or `unavailable` for a network failure.
import { type KeyObject, randomBytes } from "node:crypto";
import { chatAdmin, type NetGuard, NetGuardError } from "@unset/infrastructure-net-guard";
import { type AdminEnvelope, type ChatAdminPayload, signEnvelope } from "@unset/shared-admin-envelope";

export type ChatAdminSettings = {
  /** CHAT_ADMIN_URL: chat-admin's internal origin. */
  readonly origin: string;
  readonly env: "dev" | "prod";
  /** The caller's key and its id in chat-admin's key file (web's CHAT_ADMIN_WEB_*, the door's CHAT_ADMIN_DOOR_*). */
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
};

/** chat-admin's limit (interfaces/chat-admin/envelope.ts MAX_LIFETIME); a ticket lives no longer (ADR 0081). */
const LIFETIME = 60;

export type Fields = Pick<ChatAdminPayload, "verb" | "user" | "name" | "device" | "did" | "sid" | "state">;

/** One signed payload: the claims every verb shares, then the verb's own fields. */
export function signChat(
  settings: ChatAdminSettings,
  fields: Fields,
  now: () => number,
): AdminEnvelope<ChatAdminPayload> {
  const iat = Math.floor(now() / 1000);
  const payload: ChatAdminPayload = {
    v: 1,
    env: settings.env,
    aud: "chat-admin",
    ...fields,
    jti: randomBytes(16).toString("base64url"),
    iat,
    exp: iat + LIFETIME,
  };
  return signEnvelope(payload, settings.key);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parse(body: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export type ChatAdminAnswer =
  | { readonly status: number; readonly body: Record<string, unknown> | null }
  | "unavailable";

/** POSTs `body` as JSON to chat-admin's `path`, within `timeoutMs` and `deadline` (RE-1); no retry here. */
export async function postChatAdmin(
  guard: NetGuard,
  settings: ChatAdminSettings,
  path: string,
  body: unknown,
  timeoutMs: number,
  deadline?: AbortSignal,
): Promise<ChatAdminAnswer> {
  try {
    const res = await guard.request(chatAdmin(settings.origin), {
      url: `${settings.origin}${path}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify(body)),
      timeoutMs,
      maxBytes: 4096,
      ...(deadline === undefined ? {} : { signal: deadline }),
    });
    return { status: res.status, body: parse(res.body) };
  } catch (error) {
    if (error instanceof NetGuardError) return "unavailable";
    throw error;
  }
}
