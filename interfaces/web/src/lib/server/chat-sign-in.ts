// The unset.sh half of the unset.cc sign-in hop (build step 5; ADR 0081 decision 3; chat architecture plan "Opening
// unset.cc"; security pass finding 8). The door on unset.cc, holding no session, sets a one-time value in the browser
// and sends the tab to GET /chat/sign-in?state=<value>. For the signed-in member web signs a ticket naming them, this
// web session and that value, and sends the tab to the door's return path with the ticket in the fragment:
//
//   303 Location: <CHAT_DOOR_ORIGIN>/sign-in/return#ticket=<base64url of the envelope's JSON>
//
// A fragment never reaches a server, a log or a Referer. The door matches `state` against the value it set, then
// posts the envelope to chat-admin; chat-admin checks web's signature and burns the jti. With no value (the member
// had to sign in first, which keeps only the path) the tab goes back to the door's root to start again; a value of
// the wrong form is refused. Nothing here is logged but the route's own line, which carries no query.
import type { Did } from "@unset/domains-identity";
import { type DoorState, parseDoorState, signIn } from "@unset/domains-messaging";
import type { Session } from "@unset/infrastructure-session";
import { services } from "./compose.ts";
import { config } from "./runtime.ts";

/** The door's path that takes the ticket (the door step builds to it). */
export const DOOR_RETURN_PATH = "/sign-in/return";
const PRIVATE = { "cache-control": "private, no-store", vary: "Cookie", "referrer-policy": "no-referrer" };

const plain = (status: number, code: string) =>
  new Response(`${code}\n`, { status, headers: { ...PRIVATE, "content-type": "text/plain; charset=utf-8" } });
const redirectTo = (location: string) => new Response(null, { status: 303, headers: { ...PRIVATE, location } });

/** Exactly one well-formed one-time value, none, or a refusal. */
function stateOf(query: URLSearchParams): DoorState | null | "bad" {
  const values = query.getAll("state");
  if (values.length === 0) return null;
  return values.length === 1 ? (parseDoorState(values[0] ?? null) ?? "bad") : "bad";
}

export async function chatSignIn(
  session: Session | undefined,
  query: URLSearchParams,
  deadline: AbortSignal,
): Promise<Response> {
  if (session === undefined) return plain(401, "auth.required"); // the gate already sent a visitor to sign in
  const state = stateOf(query);
  if (state === null) return redirectTo(`${config.CHAT_DOOR_ORIGIN}/`);
  if (state === "bad") return plain(400, "chat.bad_state");
  const { chat } = services();
  const ports = { readyUser: (did: Did) => chat.readyUser(did, deadline), sign: chat.signTicket };
  const outcome = await signIn(ports, { did: session.did, idHash: session.idHash, state });
  if (outcome.kind === "not_ready") return plain(503, "chat.not_ready");
  const fragment = new URLSearchParams({ ticket: outcome.ticket });
  return redirectTo(`${config.CHAT_DOOR_ORIGIN}${DOOR_RETURN_PATH}#${fragment}`);
}
