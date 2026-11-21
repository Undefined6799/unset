// The page's start (ADR 0088 decisions 2 to 4). A page that is not the hop's return has no session, since nothing is
// ever stored, so it starts the hop. The return page redeems the ticket in this same page, puts the path the hop
// started from back in the address bar without loading anything, and opens the chat on the session it now holds in
// memory. Renewal is the hop again (a fresh mint for the same device; the door hands back the same lock key): a minute
// before the token ends, or when the server stops taking it, unless that happens within a minute of signing in, which
// would only loop. A Message link's path is turned into the start route once signed in (core/contact.ts).
import type { ChatState } from "./core/chat.ts";
import { dmTarget, startPathFor } from "./core/contact.ts";
import { publicNames } from "./core/public-name.ts";
import { askPushKey } from "./core/push.ts";
import { claimSetup, releaseSetup } from "./core/setup-claim.ts";
import { hopPath, RETURN_PATH, redeem, renewDelayMs, takeTicket } from "./core/sign-in.ts";
import { signOutDevice } from "./core/sign-out.ts";
import { openChat } from "./matrix/client.ts";

const DOOR_DEADLINE_MS = 10_000;
const TOO_SOON_MS = 60_000;
/** setTimeout's largest delay (HTML timers, a signed 32-bit count of milliseconds). */
const MAX_TIMER_MS = 2 ** 31 - 1;

const here = () => `${window.location.pathname}${window.location.search}`;
const hop = () => window.location.assign(hopPath(here()));

export async function boot(onState: (state: ChatState) => void): Promise<void> {
  if (window.location.pathname !== RETURN_PATH) {
    window.location.replace(hopPath(here()));
    return;
  }
  const ticket = takeTicket(window);
  if (ticket === null) return onState({ kind: "error", code: "chat.no_ticket" });
  const outcome = await redeem(window.fetch.bind(window), ticket, AbortSignal.timeout(DOOR_DEADLINE_MS));
  if (outcome.kind === "refused") return onState({ kind: "error", code: outcome.code });
  window.history.replaceState(null, "", outcome.returnTo);
  const signedInAt = Date.now();
  const { session } = outcome;
  // A profile's Message link (ADR 0090 decision 3): its member's chat ID, then the start route, before the list mounts.
  const member = dmTarget(outcome.returnTo);
  if (member !== null) {
    const next = await startPathFor(
      window.fetch.bind(window),
      session.deviceId,
      member,
      AbortSignal.timeout(DOOR_DEADLINE_MS),
    );
    window.history.replaceState(null, "", next);
  }
  // Renewal, unless the member has logged out by then.
  let leaving = false;
  const renew = () => leaving || hop();
  window.setTimeout(renew, Math.min(MAX_TIMER_MS, renewDelayMs(session.expiresAtMs, signedInAt)));
  const door = window.fetch.bind(window);
  const deadline = () => AbortSignal.timeout(DOOR_DEADLINE_MS);
  await openChat(session, {
    baseUrl: window.location.origin,
    setup: {
      claim: () => claimSetup(door, session.deviceId, deadline()),
      release: async () => void (await releaseSetup(door, session.deviceId, deadline())),
    },
    pushKey: () => askPushKey(door, session.deviceId, deadline()),
    signOut: () => signOutDevice(door, session.deviceId, deadline()),
    names: publicNames(door, session.deviceId, deadline),
    onState: (state) => {
      if (state.kind === "logging_out") leaving = true;
      onState(state);
    },
    onSignedOut: () => {
      if (leaving) return;
      if (Date.now() - signedInAt < TOO_SOON_MS) return onState({ kind: "error", code: "chat.session_refused" });
      onState({ kind: "signed_out" });
      hop();
    },
  });
}
