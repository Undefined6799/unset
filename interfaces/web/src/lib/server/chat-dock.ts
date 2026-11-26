// The chat icon's number for the shell around the chat box (ADR 0115). The box signs in through the ordinary hop's
// GET /chat/sign-in, which the shell points the box's frame at (chat-sign-in.ts DOOR_DOCK_PATH), so no ticket ever
// passes through this page's script (chat box review D1).
import type { RequestEvent } from "@sveltejs/kit";
import { services } from "./compose.ts";

const PRIVATE = { "cache-control": "private, no-store", vary: "Cookie", "content-type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: PRIVATE });

/** GET /chat/count: the number of chats with new messages, so the shell's chat icon stays current without a reload. */
export async function chatCount(event: RequestEvent): Promise<Response> {
  const did = event.locals.did;
  if (did === undefined) return json(401, { error: "auth.required" });
  try {
    return json(200, { unread: (await services().chat.count(did, event.locals.deadline)) ?? 0 });
  } catch (cause) {
    services().log.warn("shell.chat_count_failed", { kind: cause instanceof Error ? cause.name : "Error" });
    return json(503, { error: "chat.unavailable" });
  }
}
