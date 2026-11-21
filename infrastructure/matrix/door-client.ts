// The door's side of chat-admin (build step 6; ADR 0093 decisions 4 and 5). A mint passes web's ticket on as it came,
// with the browser's device for a renewal, so the door never signs a mint: only web's key can. session.end is signed
// with the door's own key, the only verb chat-admin lets that key use (interfaces/chat-admin/envelope.ts
// ISSUER_VERBS). Only a well-formed session counts as minted; every other answer is a refusal or unavailable. No
// retry here (RE-1): the browser runs the hop again.
import {
  type AccessToken,
  type ChatUser,
  type DeviceId,
  type EndOutcome,
  type MintOutcome,
  parseDeviceId,
} from "@unset/domains-messaging";
import type { NetGuard } from "@unset/infrastructure-net-guard";
import { type ChatAdminSettings, postChatAdmin, signChat } from "./chat-admin-call.ts";

/** Inside the ticket's 60 seconds and the door's request deadline. */
const TIMEOUT_MS = 8000;
const TOKEN = /^[\x21-\x7e]{1,512}$/;
/** chat-admin's SESSION_TTL_SECONDS is at most 30 days (interfaces/chat-admin/config.ts). */
const MAX_TTL_S = 30 * 86_400;

/** chat-admin's session.mint answers (interfaces/chat-admin/server.ts answerFor, commands.ts mintSession). */
function mintedOf(status: number, body: Record<string, unknown> | null): MintOutcome {
  if (status === 200) {
    const device = parseDeviceId(body?.device);
    const { token, expiresIn } = body ?? {};
    const ttlOk =
      typeof expiresIn === "number" && Number.isSafeInteger(expiresIn) && expiresIn > 0 && expiresIn <= MAX_TTL_S;
    if (typeof token !== "string" || !TOKEN.test(token) || device === null || !ttlOk) return { kind: "unavailable" };
    return { kind: "minted", token: token as AccessToken, device, expiresInS: expiresIn };
  }
  if (status === 409 && body?.error === "device_ended") return { kind: "device_ended" };
  if (status === 400 || status === 403 || status === 409) return { kind: "refused" };
  return { kind: "unavailable" };
}

export function createDoorChatAdminClient(guard: NetGuard, settings: ChatAdminSettings, now = () => Date.now()) {
  return {
    async mint(envelope: unknown, device: DeviceId | null, deadline: AbortSignal): Promise<MintOutcome> {
      const answer = await postChatAdmin(
        guard,
        settings,
        "/v1/session.mint",
        { ticket: envelope, device },
        TIMEOUT_MS,
        deadline,
      );
      return answer === "unavailable" ? { kind: "unavailable" } : mintedOf(answer.status, answer.body);
    },
    async end(user: ChatUser, device: DeviceId, deadline: AbortSignal): Promise<EndOutcome> {
      const envelope = signChat(
        settings,
        { verb: "session.end", user, name: "", device, did: "", sid: "", state: "" },
        now,
      );
      const answer = await postChatAdmin(guard, settings, "/v1/session.end", envelope, TIMEOUT_MS, deadline);
      return answer !== "unavailable" && answer.status === 200 ? { kind: "ended" } : { kind: "unavailable" };
    },
  };
}

export type DoorChatAdminClient = ReturnType<typeof createDoorChatAdminClient>;
