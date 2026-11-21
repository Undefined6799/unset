// unset.sh's Log out reaching chat (ADR 0083 decision 5; Alex 2026-11-21: there is no Log out on the chat page, and
// logging out of unset.sh must wipe chat in that browser). POST /logout ends the web session and queues the chat
// devices it signed in, in one commit. When that queued any, this browser holds one of them: a web session lives in
// one browser's cookie, and the sign-in hop binds the door's entry to the browser that started it (chat-sign-in.ts).
// So the count from that commit is how web knows, with no new state on either origin. web then signs a session.mint
// ticket for the ended session with a random one-time value (no browser started this hop) and sends the tab through
// GET /logout/chat to the door:
//
//   <meta http-equiv="refresh" content="0;url=<CHAT_DOOR_ORIGIN>/sign-out/return#ticket=<base64url envelope>">
//
// The chat page there spends the ticket at POST /sign-out/redeem on the device this browser holds, waits for the key
// backup, logs the device out at the door and deletes its stores, then comes back to /signed-out. If the tab never
// arrives, the queued end fires anyway (LOGOUT_CHAT_AFTER_S). A fragment reaches no server, log or Referer.
import { randomBytes } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import { parseDoorState, signIn } from "@unset/domains-messaging";
import type { Session } from "@unset/infrastructure-session";
import { services } from "./compose.ts";
import { config } from "./runtime.ts";
import { chatTicketFromCookies } from "./sign-in-state.ts";

/** The door's page that takes the ticket (interfaces/chat-auth door.ts SIGN_OUT_RETURN_PATH). */
export const DOOR_SIGN_OUT_PATH = "/sign-out/return";

const className = (cause: unknown): string => (cause instanceof Error && cause.name !== "" ? cause.name : "Error");

/**
 * The ticket for `session`, which POST /logout has just ended, or null when the member's chat account is not ready
 * (the door would refuse it) or it cannot be signed; the queued end covers both.
 */
export async function chatSignOutTicket(session: Session, deadline: AbortSignal): Promise<string | null> {
  const { chat, log } = services();
  const state = parseDoorState(randomBytes(32).toString("base64url"));
  if (state === null) return null;
  try {
    const ports = { readyUser: (did: Did) => chat.readyUser(did, deadline), sign: chat.signTicket };
    const outcome = await signIn(ports, { did: session.did, idHash: session.idHash, state });
    return outcome.kind === "ticket" ? outcome.ticket : null;
  } catch (cause: unknown) {
    log.warn("chat.sign_out_ticket_failed", { kind: className(cause) });
    return null;
  }
}

/** Where GET /logout/chat sends the tab: the door's page with the carried ticket, or null without one. */
export function chatSignOutTarget(cookieHeader: string | null): string | null {
  const ticket = chatTicketFromCookies(cookieHeader);
  if (ticket === null) return null;
  return `${config.CHAT_DOOR_ORIGIN}${DOOR_SIGN_OUT_PATH}#${new URLSearchParams({ ticket })}`;
}
