// The unset.cc sign-in hop, web's part (ADR 0081 decision 3; chat architecture plan "Opening unset.cc"; security
// pass finding 8). The door sets a one-time value in the browser and sends the tab here with it; web signs a ticket
// for the signed-in member that names that value, so the door redeems it only in the browser that started the hop:
// a finished link sent to someone else carries a value their browser never had. web signs only for a member whose
// chat account exists, and never holds the session it mints.
import { createHash } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import type { ChatUser } from "./chat-account.ts";

declare const stateBrand: unique symbol;
/** The door's one-time value: 32 random bytes, base64url without padding. */
export type DoorState = string & { readonly [stateBrand]: true };
declare const sessionBrand: unique symbol;
/** A one-way reference to the web session a ticket came from, so web's Log out can later name the browsers it signed. */
export type SessionRef = string & { readonly [sessionBrand]: true };

const STATE = /^[A-Za-z0-9_-]{43}$/;

export function parseDoorState(raw: string | null): DoorState | null {
  return raw !== null && STATE.test(raw) ? (raw as DoorState) : null;
}

/**
 * sha256 over a fixed label and the session row's key (the hash of its cookie), base64url: the same session always
 * gives the same reference, and the reference neither opens the session nor finds its row.
 */
export function sessionRef(idHash: Uint8Array): SessionRef {
  return createHash("sha256")
    .update("unset.sh chat sign-in session v1\0")
    .update(idHash)
    .digest("base64url") as SessionRef;
}

/** What a ticket names besides its single-use id and its 60-second life, which the signer adds. */
export type SignInTicket = {
  readonly user: ChatUser;
  readonly did: Did;
  readonly sid: SessionRef;
  readonly state: DoorState;
};

export type SignInPorts = {
  /** The member's chat user once their chat account is created, else null. */
  readonly readyUser: (did: Did) => Promise<ChatUser | null>;
  /** The ticket as web signs it (an envelope for chat-admin's session.mint), encoded for the door. */
  readonly sign: (ticket: SignInTicket) => string;
};

export type SignInOutcome = { readonly kind: "ticket"; readonly ticket: string } | { readonly kind: "not_ready" };

/** The ticket for the signed-in member `did` on the web session `idHash`, bound to the door's `state`. */
export async function signIn(
  ports: SignInPorts,
  request: { readonly did: Did; readonly idHash: Uint8Array; readonly state: DoorState },
): Promise<SignInOutcome> {
  const user = await ports.readyUser(request.did);
  if (user === null) return { kind: "not_ready" };
  const ticket = ports.sign({ user, did: request.did, sid: sessionRef(request.idHash), state: request.state });
  return { kind: "ticket", ticket };
}
