// web's side of chat-admin (ADR 0081 decisions 3 and 5; build plan step 2): sign one envelope with web's Ed25519 key
// for each call, post it to chat-admin through net-guard's chat-admin policy, and map the answer to the messaging
// domain's outcomes. A fresh `jti` per call, so a retry after `unavailable` is a new request; chat-admin answers a
// second create for an account MAS already holds as created, so a lost reply is harmless. Retries are the queued
// job's (domains/messaging createDueAccounts), never here (rule RE-1: one layer).
import { type KeyObject, randomBytes } from "node:crypto";
import type { Handle } from "@unset/domains-identity";
import type { ChatAccountCreation, ChatUser } from "@unset/domains-messaging";
import { chatAdmin, type NetGuard, NetGuardError } from "@unset/infrastructure-net-guard";
import { type ChatAdminPayload, signEnvelope } from "@unset/shared-admin-envelope";

export type ChatAdminSettings = {
  /** CHAT_ADMIN_URL: chat-admin's internal origin. */
  readonly origin: string;
  readonly env: "dev" | "prod";
  /** web's key (CHAT_ADMIN_WEB_KEY) and its id in chat-admin's key file (CHAT_ADMIN_WEB_KID). */
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
};

/** chat-admin's limit (interfaces/chat-admin/envelope.ts MAX_LIFETIME); a ticket lives no longer (ADR 0081). */
const LIFETIME = 60;
/** Under the job's lease and inside the envelope's own life. */
const TIMEOUT_MS = 8000;

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

/** chat-admin's account.create answers (interfaces/chat-admin/server.ts); any shape it does not expect is unavailable. */
function creationOf(status: number, body: Record<string, unknown> | null): ChatAccountCreation {
  if (status === 200 && typeof body?.created === "boolean") return { kind: "created" };
  if (status === 409 && body?.error === "username_taken") return { kind: "taken" };
  if (status === 400) return { kind: "rejected" };
  return { kind: "unavailable" };
}

type Fields = Pick<ChatAdminPayload, "verb" | "user" | "name" | "device" | "did" | "sid" | "state">;

export function createChatAdminClient(guard: NetGuard, settings: ChatAdminSettings, now = () => Date.now()) {
  const policy = chatAdmin(settings.origin);

  /** One signed payload: the claims every verb shares, then the verb's own fields. */
  const sign = (fields: Fields) => {
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
  };

  /** Creates `user` with the verified handle as its display name; ends at `deadline` or after 8 s (RE-1). */
  async function createAccount(user: ChatUser, name: Handle, deadline?: AbortSignal): Promise<ChatAccountCreation> {
    const envelope = sign({ verb: "account.create", user, name, device: "", did: "", sid: "", state: "" });
    try {
      const res = await guard.request(policy, {
        url: `${settings.origin}/v1/account.create`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify(envelope)),
        timeoutMs: TIMEOUT_MS,
        maxBytes: 4096,
        ...(deadline === undefined ? {} : { signal: deadline }),
      });
      return creationOf(res.status, parse(res.body));
    } catch (error) {
      if (error instanceof NetGuardError) return { kind: "unavailable" };
      throw error;
    }
  }

  return { createAccount };
}

export type ChatAdminClient = ReturnType<typeof createChatAdminClient>;
