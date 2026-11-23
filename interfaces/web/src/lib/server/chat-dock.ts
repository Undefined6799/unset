// The unset.sh half of the chat box's sign-in (ADR 0115). The box is the chat page in a frame on unset.sh, on
// unset.cc's origin, so the browser keeps its storage and cookies apart from a unset.cc tab (storage partitioning) and
// it is a browser of its own to chat. It cannot use the sign-in hop: a navigation the unset.cc frame starts to unset.sh
// carries no unset.sh session cookie, Lax or Strict (tested, Chromium 157, 2026-11-23). So the shell does the hop's
// middle step for it. The box sets its one-time value in its own cookie (the door reads it at redeem, as on the hop),
// sends the value to the shell, which posts it here with the session; web signs the same ticket as GET /chat/sign-in
// does (chat-sign-in.ts) and answers it as JSON; the shell passes it back to the box, which redeems it at the door.
// A ticket is bound to the value in the box's own cookie on unset.cc, so a script that reads it on unset.sh cannot
// redeem it anywhere else (security pass finding 8). POST only, a form body, under the gate's Origin check.
import type { RequestEvent } from "@sveltejs/kit";
import type { Did } from "@unset/domains-identity";
import { parseDoorState, signIn } from "@unset/domains-messaging";
import { services } from "./compose.ts";
import { gateSession } from "./session.ts";

const PRIVATE = { "cache-control": "private, no-store", vary: "Cookie", "content-type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: PRIVATE });

/** POST /chat/dock: `state=<one-time value>` in, `{ ticket }` out, for the signed-in member the app gate let in. */
export async function chatDockTicket(event: RequestEvent): Promise<Response> {
  const session = gateSession(event);
  if (session === undefined) return json(401, { error: "auth.required" }); // the gate already refused this
  const values = (await event.request.formData()).getAll("state");
  const state = values.length === 1 && typeof values[0] === "string" ? parseDoorState(values[0]) : null;
  if (state === null) return json(400, { error: "chat.bad_state" });
  const { chat } = services();
  const { deadline } = event.locals;
  const ports = { readyUser: (did: Did) => chat.readyUser(did, deadline), sign: chat.signTicket };
  const outcome = await signIn(ports, { did: session.did, idHash: session.idHash, state });
  if (outcome.kind === "not_ready") return json(503, { error: "chat.not_ready" });
  return json(200, { ticket: outcome.ticket });
}

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
