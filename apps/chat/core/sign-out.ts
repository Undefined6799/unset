// The page's half of Log out (ADR 0095 decision 5): the door's POST /sign-out (interfaces/chat-auth/routes.ts
// signOutRoute) ends the device this browser holds through chat-admin, which removes the device and its pusher, and
// deletes the lock key. The page names only that device; same-origin, uncached. Done or not, never the door's words.
// There is no Log out on this page (Alex 2026-11-21): unset.sh's Log out sends the tab to /sign-out/return with a
// ticket for the session it just ended (interfaces/web chat-sign-out.ts), and signOutHere runs it.
import type { ChatSession } from "./chat.ts";
import { type Fetch, postTicket, sessionOf } from "./sign-in.ts";

export const SIGN_OUT_RETURN_PATH = "/sign-out/return";
/** The door's way back to unset.sh's signed-out page (interfaces/chat-auth door.ts). */
export const SIGNED_OUT_PATH = "/sign-out/done";
const SIGN_OUT_REDEEM_PATH = "/sign-out/redeem";

/** True once the door has ended `deviceId` for this browser; false for any other answer or none. */
export async function signOutDevice(fetchFn: Fetch, deviceId: string, deadline: AbortSignal): Promise<boolean> {
  try {
    const response = await fetchFn("/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
    });
    const body = (await response.json()) as { signedOut?: unknown } | null;
    return response.status === 200 && body?.signedOut === true;
  } catch {
    return false;
  }
}

export type SignOutRedeemed =
  | { readonly kind: "signed_in"; readonly session: ChatSession }
  | { readonly kind: "refused"; readonly code: string };

/** unset.sh's ticket for the device this browser holds: a session on it, held in memory only, or a fixed code. */
export async function redeemForSignOut(
  fetchFn: Fetch,
  ticket: string,
  deadline: AbortSignal,
): Promise<SignOutRedeemed> {
  const answer = await postTicket(fetchFn, SIGN_OUT_REDEEM_PATH, ticket, deadline);
  if (answer.kind !== "ok") return answer;
  const session = sessionOf(answer.body);
  // The door never makes a device here, so nothing in this browser is from an ended one.
  return session === null
    ? { kind: "refused", code: "chat.unavailable" }
    : { kind: "signed_in", session: { ...session, newDevice: false } };
}

/** What signOutHere does, each one I/O: the door, the tab lock, the client, and the way back to unset.sh. */
export type SignOutSteps = {
  readonly redeem: (ticket: string) => Promise<SignOutRedeemed>;
  /** Takes the one-tab lock from any tab that holds it, whose client then stops (core/tab-lock.ts); true when held. */
  readonly takeOver: () => Promise<boolean>;
  /** Opens this browser's store on `session` and runs the client's Log out (matrix/client.ts openToLogOut). */
  readonly logOut: (session: ChatSession) => Promise<unknown>;
  /** The door's Log out of the device alone (signOutDevice). */
  readonly endDevice: (session: ChatSession) => Promise<boolean>;
  readonly leave: () => void;
};

/**
 * The page at /sign-out/return. Anyone can link here, so until the door has spent web's ticket on this browser's own
 * device (POST /sign-out/redeem) no tab is stopped and nothing is deleted. Then chat stops in any other tab, the key
 * backup catches up, the door ends the device and deletes its lock key, and the stores go. Without the tab lock the
 * store stays shut and only the device is ended; its store then opens with no key. Whatever happens, the tab goes back
 * to unset.sh's signed-out page, and web's queued end covers what did not finish.
 */
export async function signOutHere(steps: SignOutSteps, ticket: string | null): Promise<void> {
  try {
    if (ticket === null) return;
    const redeemed = await steps.redeem(ticket);
    if (redeemed.kind !== "signed_in") return;
    if (await steps.takeOver()) await steps.logOut(redeemed.session);
    else await steps.endDevice(redeemed.session);
  } finally {
    steps.leave();
  }
}
