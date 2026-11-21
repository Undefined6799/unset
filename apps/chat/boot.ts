// The page's start (ADR 0088 decisions 2 to 4). A page that is not the hop's return has no session, since nothing is
// ever stored, so it starts the hop. The return page redeems the ticket in this same page, puts the path the hop
// started from back in the address bar without loading anything, and opens the chat on the session it now holds in
// memory. Renewal is the hop again (a fresh mint for the same device; the door hands back the same lock key): a minute
// before the token ends, or when the server stops taking it, unless that happens within a minute of signing in, which
// would only loop. A Message link's path is turned into the start route once signed in (core/contact.ts).
// Before any of it the page takes the one-tab lock (core/tab-lock.ts): a tab that finds chat open in another signs
// nothing in, hops nowhere and opens no key store until the member chooses to use chat there, which takes the lock over
// and starts a fresh hop; the tab that lost it stops its client at once.
import type { ChatState } from "./core/chat.ts";
import { dmTarget, startPathFor } from "./core/contact.ts";
import { askPushKey } from "./core/push.ts";
import { claimSetup, releaseSetup } from "./core/setup-claim.ts";
import { hopPath, RETURN_PATH, redeem, renewDelayMs, takeTicket } from "./core/sign-in.ts";
import { signOutDevice } from "./core/sign-out.ts";
import { holdTabLock } from "./core/tab-lock.ts";
import { openChat } from "./matrix/client.ts";

const DOOR_DEADLINE_MS = 10_000;
const TOO_SOON_MS = 60_000;
/** setTimeout's largest delay (HTML timers, a signed 32-bit count of milliseconds). */
const MAX_TIMER_MS = 2 ** 31 - 1;

const here = () => `${window.location.pathname}${window.location.search}`;
const hop = () => window.location.assign(hopPath(here()));

export async function boot(onState: (state: ChatState) => void): Promise<void> {
  // The ticket leaves the address bar first, whatever comes next (core/sign-in.ts).
  const returning = window.location.pathname === RETURN_PATH;
  const ticket = returning ? takeTicket(window) : null;
  // Set once another tab has taken chat over: this page then stops and says only that (core/tab-lock.ts).
  const elsewhere = new AbortController();
  const openElsewhere = () => onState({ kind: "open_elsewhere", useHere: () => void useHere() });
  const lost = () => {
    elsewhere.abort();
    openElsewhere();
  };
  // A fresh hop in this tab once it holds the lock: a ticket held while it waited may be old, and the hop state it
  // matches may be another tab's by now. The return path itself is no place to come back to.
  const useHere = async () => {
    const outcome = await holdTabLock(navigator.locks, "take_over", lost);
    if (outcome !== "held") return onState({ kind: "error", code: "chat.tab_lock_unavailable" });
    window.location.assign(hopPath(returning ? "/" : here()));
  };
  const outcome = await holdTabLock(navigator.locks, "if_free", lost);
  if (outcome === "unavailable") return onState({ kind: "error", code: "chat.tab_lock_unavailable" });
  if (outcome === "elsewhere") return openElsewhere();
  if (!returning) {
    window.location.replace(hopPath(here()));
    return;
  }
  await signIn(ticket, elsewhere.signal, (state) => elsewhere.signal.aborted || onState(state));
}

/** The return page's work, in this tab only while it holds the lock: nothing reaches `onState` once `gone` is set. */
async function signIn(ticket: string | null, gone: AbortSignal, onState: (state: ChatState) => void): Promise<void> {
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
  // Renewal, unless the member has logged out by then or chat has moved to another tab.
  let leaving = false;
  const renew = () => leaving || gone.aborted || hop();
  window.setTimeout(renew, Math.min(MAX_TIMER_MS, renewDelayMs(session.expiresAtMs, signedInAt)));
  const door = window.fetch.bind(window);
  const deadline = () => AbortSignal.timeout(DOOR_DEADLINE_MS);
  await openChat(session, {
    baseUrl: window.location.origin,
    takenOver: gone,
    setup: {
      claim: () => claimSetup(door, session.deviceId, deadline()),
      release: async () => void (await releaseSetup(door, session.deviceId, deadline())),
    },
    pushKey: () => askPushKey(door, session.deviceId, deadline()),
    signOut: () => signOutDevice(door, session.deviceId, deadline()),
    onState: (state) => {
      if (state.kind === "logging_out") leaving = true;
      onState(state);
    },
    onSignedOut: () => {
      if (leaving || gone.aborted) return;
      if (Date.now() - signedInAt < TOO_SOON_MS) return onState({ kind: "error", code: "chat.session_refused" });
      onState({ kind: "signed_out" });
      hop();
    },
  });
}
