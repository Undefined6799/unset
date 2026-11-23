// The page's start (ADR 0099 decisions 2 to 4). A page that is not the hop's return has no session, since nothing is
// ever stored, so it starts the hop. The return page redeems the ticket in this same page, puts the path the hop
// started from back in the address bar without loading anything, and opens the chat on the session it now holds in
// memory. Renewal is the hop again (a fresh mint for the same device; the door hands back the same lock key): a minute
// before the token ends, or when the server stops taking it, unless that happens within a minute of signing in, which
// would only loop. A Message link's path is turned into the start route once signed in (core/contact.ts).
// Before any of it the page takes the one-tab lock (core/tab-lock.ts): a tab that finds chat open in another signs
// nothing in, hops nowhere and opens no key store until the member chooses to use chat there, which takes the lock over
// and starts a fresh hop; the tab that lost it stops its client at once.
// The page has no Log out (Alex 2026-11-21): unset.sh's Log out sends the tab to /sign-out/return, which logs this
// browser out of chat (core/sign-out.ts signOutHere) and goes back to unset.sh.
import type { ChatSession, ChatState } from "./core/chat.ts";
import { dmTarget, startPathFor } from "./core/contact.ts";
import { boxVisibility, DOCK, type DockMode, dockMessage, stateCookie, unreadChats } from "./core/dock.ts";
import { publicNames } from "./core/public-name.ts";
import { askPushKey } from "./core/push.ts";
import { claimSetup, releaseSetup } from "./core/setup-claim.ts";
import { DOCK_REDEEM_PATH, hopPath, RETURN_PATH, redeem, renewDelayMs, takeTicket } from "./core/sign-in.ts";
import {
  redeemForSignOut,
  SIGN_OUT_RETURN_PATH,
  SIGNED_OUT_PATH,
  signOutDevice,
  signOutHere,
} from "./core/sign-out.ts";
import { announceHop, HOP_CHANNEL, holdTabLock } from "./core/tab-lock.ts";
import { type Chat, type ChatOptions, openChat, openToLogOut } from "./matrix/client.ts";

const DOOR_DEADLINE_MS = 10_000;
const TOO_SOON_MS = 60_000;
/** setTimeout's largest delay (HTML timers, a signed 32-bit count of milliseconds). */
const MAX_TIMER_MS = 2 ** 31 - 1;

const here = () => `${window.location.pathname}${window.location.search}`;
/** Where this tab tells the others it leaves for the hop, so one waiting for the lock does not hop too (tab-lock.ts). */
const hops = new BroadcastChannel(HOP_CHANNEL);
const hop = () => {
  announceHop(hops);
  window.location.assign(hopPath(here()));
};

export async function boot(onState: (state: ChatState) => void): Promise<void> {
  // The ticket leaves the address bar first, whatever comes next (core/sign-in.ts).
  if (window.location.pathname === SIGN_OUT_RETURN_PATH) return signOut(takeTicket(window), onState);
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
    announceHop(hops);
    window.location.assign(hopPath(returning ? "/" : here()));
  };
  const outcome = await holdTabLock(navigator.locks, "if_free", lost, { hops });
  if (outcome === "unavailable") return onState({ kind: "error", code: "chat.tab_lock_unavailable" });
  if (outcome === "elsewhere") return openElsewhere();
  if (!returning) {
    announceHop(hops);
    window.location.replace(hopPath(here()));
    return;
  }
  await signIn(ticket, elsewhere.signal, (state) => elsewhere.signal.aborted || onState(state));
}

/** How a signed-in page gets its next session: the hop for a tab; for the chat box, the box's own sign-in again. */
type Renewal = {
  readonly redeemPath?: string;
  readonly renew: () => void;
  /** The session, once redeemed: the chat box opens a Message link's conversation with it. */
  readonly onSession?: (session: ChatSession) => void;
  /** Whether the member sees the chat: the box's own, as the shell can hide it (core/dock.ts boxVisibility). */
  readonly page?: ChatOptions["page"];
  /** The open chat, once there is one: the chat box logs it out when unset.sh's Log out asks (core/dock.ts). */
  readonly onChat?: (chat: Chat) => void;
};
const TAB: Renewal = { renew: () => hop() };

/** The return page's work, in this tab only while it holds the lock: nothing reaches `onState` once `gone` is set. */
async function signIn(
  ticket: string | null,
  gone: AbortSignal,
  onState: (state: ChatState) => void,
  renewal: Renewal = TAB,
): Promise<void> {
  if (ticket === null) return onState({ kind: "error", code: "chat.no_ticket" });
  const outcome = await redeem(
    window.fetch.bind(window),
    ticket,
    AbortSignal.timeout(DOOR_DEADLINE_MS),
    renewal.redeemPath,
  );
  if (outcome.kind === "refused") return onState({ kind: "error", code: outcome.code });
  if (renewal === TAB) window.history.replaceState(null, "", outcome.returnTo);
  const signedInAt = Date.now();
  const { session } = outcome;
  renewal.onSession?.(session);
  // A profile's Message link (ADR 0101 decision 3): its member's chat ID, then the start route, before the list mounts.
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
  // Renewal, unless chat has moved to another tab by then.
  const renew = () => gone.aborted || renewal.renew();
  window.setTimeout(renew, Math.min(MAX_TIMER_MS, renewDelayMs(session.expiresAtMs, signedInAt)));
  const door = window.fetch.bind(window);
  const deadline = () => AbortSignal.timeout(DOOR_DEADLINE_MS);
  const chat = await openChat(session, {
    baseUrl: window.location.origin,
    takenOver: gone,
    setup: {
      claim: () => claimSetup(door, session.deviceId, deadline()),
      release: async () => void (await releaseSetup(door, session.deviceId, deadline())),
    },
    pushKey: () => askPushKey(door, session.deviceId, deadline()),
    signOut: () => signOutDevice(door, session.deviceId, deadline()),
    names: publicNames(door, session.deviceId, deadline),
    page: renewal.page,
    onState,
    onSignedOut: () => {
      if (gone.aborted) return;
      if (Date.now() - signedInAt < TOO_SOON_MS) return onState({ kind: "error", code: "chat.session_refused" });
      onState({ kind: "signed_out" });
      renewal.renew();
    },
  });
  renewal.onChat?.(chat);
}

/**
 * /sign-out/return: unset.sh's Log out for this browser (core/sign-out.ts signOutHere). The tab lock is taken over only
 * once the ticket is spent, so a link that carries no good ticket stops no other tab; the tab that loses the lock stops
 * its client at once (boot's `lost`).
 */
async function signOut(ticket: string | null, onState: (state: ChatState) => void): Promise<void> {
  onState({ kind: "signing_out" });
  const door = window.fetch.bind(window);
  const deadline = () => AbortSignal.timeout(DOOR_DEADLINE_MS);
  const takenOver = new AbortController();
  await signOutHere(
    {
      redeem: (t) => redeemForSignOut(door, t, deadline()),
      takeOver: async () => (await holdTabLock(navigator.locks, "take_over", () => takenOver.abort())) === "held",
      logOut: async (session) => {
        const endDevice = () => signOutDevice(door, session.deviceId, deadline());
        const chat = await openToLogOut(session, {
          baseUrl: window.location.origin,
          takenOver: takenOver.signal,
          signOut: endDevice,
        });
        return chat.logOut();
      },
      endDevice: (session) => signOutDevice(door, session.deviceId, deadline()),
      leave: () => window.location.replace(SIGNED_OUT_PATH),
    },
    ticket,
  );
}

/** The chat box's Close: asks the shell to hide the box (it stays signed in, hidden, until the page goes). */
export let closeDock: () => void = () => undefined;
/** The chat box tells the shell what it shows, so the shell sizes and places the frame (core/dock.ts DockMode). */
export let dockLayout: (mode: DockMode) => void = () => undefined;

/** How long the chat box waits for unset.sh's hello and for its ticket. */
const DOCK_WAIT_MS = 15_000;
/** Where the chat box starts again: its own root, so it stays the box (core/dock.ts isDock). */
const DOCK_PATH = "/?dock";

/**
 * The chat box framed on unset.sh (ADR 0115; core/dock.ts says the messages). It takes the one-tab lock as a tab does,
 * among the boxes of every unset.sh tab, signs in through the shell, tells the shell its count, and opens a Message
 * link's conversation when the shell asks (`onOpen` remounts the list on the start route). Renewal starts the box
 * again at its root, which signs in again on the same device.
 */
export async function bootDock(
  onState: (state: ChatState) => void,
  onOpen: () => void,
  onList: (kind: "list" | "back") => void,
): Promise<void> {
  const parent = window.parent;
  let origin: string | null = null;
  let session: ChatSession | null = null;
  let chat: Chat | null = null;
  let asked: string | null = null;
  let hello: () => void = () => undefined;
  const helloed = new Promise<void>((resolve) => (hello = resolve));
  // Back from the hop the shell sent the frame on (web's GET /chat/sign-in?dock), the ticket is in the fragment; it
  // leaves the address first, whatever comes next (core/sign-in.ts takeTicket).
  const ticket = takeTicket(window, DOCK_PATH);
  const door = window.fetch.bind(window);
  const seen = boxVisibility(document);
  const openWith = async (did: string) => {
    if (session === null) {
      asked = did;
      return;
    }
    const next = await startPathFor(door, session.deviceId, did, AbortSignal.timeout(DOOR_DEADLINE_MS));
    window.history.replaceState(null, "", next);
    onOpen();
  };
  window.addEventListener("message", (event) => {
    const message = dockMessage(event, parent, origin);
    if (message === null) return;
    if (message.kind === "hello") {
      origin ??= message.origin;
      tell({ type: `${DOCK}layout`, mode });
      return hello();
    }
    if (message.kind === "shown") return seen.setShown(message.shown);
    if (message.kind === "log_out") return void logOut();
    if (message.kind === "list" || message.kind === "back") return onList(message.kind);
    void openWith(message.did);
  });
  const tell = (data: Record<string, unknown>) => origin !== null && parent.postMessage(data, origin);
  closeDock = () => tell({ type: `${DOCK}close` });
  // The last one is said again at each hello, as the shell loses it when the box's page loads again.
  let mode: DockMode = "list";
  dockLayout = (next) => {
    mode = next;
    tell({ type: `${DOCK}layout`, mode });
  };
  // unset.sh's Log out (chat box review D3): the tab's own Log out happens on unset.cc's top level, which cannot reach
  // this partition, so the box runs it here, as the tab's /sign-out/return does: the backup catches up, the door ends
  // the device, the stores go. The queued end web makes at /logout stays the fallback.
  const logOut = async () => {
    await chat?.logOut().catch(() => undefined);
    tell({ type: `${DOCK}logged_out` });
  };
  // The shell speaks first, once the frame has loaded (core/dock.ts), so the box never posts to an origin it has not
  // been told: the listener above is in place before the page's load event.
  const timeout = new Promise<"late">((resolve) => window.setTimeout(() => resolve("late"), DOCK_WAIT_MS));
  if ((await Promise.race([helloed, timeout])) === "late")
    return onState({ kind: "error", code: "chat.dock_no_shell" });

  let stopCount: (() => void) | null = null;
  const report = (state: ChatState) => {
    if (state.kind === "ready") {
      stopCount?.();
      stopCount = state.conversations.watchList((list) => tell({ type: `${DOCK}count`, unread: unreadChats(list) }));
    }
    onState(state);
  };
  const elsewhere = new AbortController();
  const start = async () => {
    if (ticket === null) {
      // The hop: the box keeps its one-time value in its own cookie and asks the shell to send the frame to web's
      // sign-in, which comes back here with the ticket (core/dock.ts). The page normally leaves before the wait ends.
      const state = randomState();
      document.cookie = stateCookie(state);
      announceHop(hops);
      tell({ type: `${DOCK}sign_in`, state });
      window.setTimeout(() => onState({ kind: "error", code: "chat.dock_refused" }), DOCK_WAIT_MS);
      return;
    }
    await signIn(ticket, elsewhere.signal, (s) => elsewhere.signal.aborted || report(s), {
      redeemPath: DOCK_REDEEM_PATH,
      renew: () => window.location.replace(DOCK_PATH),
      page: seen,
      onChat: (opened) => (chat = opened),
      onSession: (s) => {
        session = s;
        if (asked !== null) void openWith(asked);
      },
    });
  };
  const lost = () => {
    elsewhere.abort();
    onState({ kind: "open_elsewhere", useHere: () => void useHere() });
  };
  const useHere = async () => {
    const outcome = await holdTabLock(navigator.locks, "take_over", lost);
    if (outcome !== "held") return onState({ kind: "error", code: "chat.tab_lock_unavailable" });
    window.location.replace(DOCK_PATH);
  };
  const outcome = await holdTabLock(navigator.locks, "if_free", lost, { hops });
  if (outcome === "unavailable") return onState({ kind: "error", code: "chat.tab_lock_unavailable" });
  if (outcome === "elsewhere") return onState({ kind: "open_elsewhere", useHere: () => void useHere() });
  await start();
}

/** 32 random bytes as base64url, the door's one-time value (domains/messaging parseDoorState). */
function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
