// The chat box's side of its talk with unset.sh (ADR 0115). unset.sh's shell frames this page at /?dock, on this
// origin, so the browser keeps the box's storage and cookies apart from a unset.cc tab and the box is a browser of its
// own to chat. A frame's navigation to unset.sh carries no unset.sh session (tested, Chromium 157, 2026-11-23), so the
// box cannot take the sign-in hop; the shell does its middle step:
//
//   shell -> box   unset.dock.hello                 at the frame's load event, to unset.cc's origin; the box keeps
//                                                   the sender's origin from here on, so it never posts to "*"
//   box -> shell   unset.dock.sign_in { state }     the one-time value, also in the box's own cookie
//   shell -> box   unset.dock.ticket { ticket }     web's ticket for that value (POST /chat/dock), or null
//   box -> door    POST /sign-in/redeem?dock        as the hop's redeem; the door matches the value in the cookie
//   box -> shell   unset.dock.count { unread }      for the chat icon
//   box -> shell   unset.dock.close                 the box's Close
//   shell -> box   unset.dock.open { did }          a profile's Message link
//   shell -> box   unset.dock.shown { shown }       with the hello and at each change: whether the box is open
//
// The box takes a message only from its parent window (MessageEvent.source), whose origin the page's frame-ancestors
// pins to unset.sh (interfaces/chat-auth door.ts rootDocument), and after the hello only from that origin
// (HTML "Cross-document messaging", https://html.spec.whatwg.org/multipage/web-messaging.html, read 2026-11-23: check
// origin and source). A script on unset.sh that reads the ticket gains nothing: the door redeems it only with the
// value in this box's own cookie (security pass finding 8). Nothing secret is ever posted to the shell.
import type { Conversation } from "./conversations.ts";

export const DOCK = "unset.dock.";
const MAX_TICKET = 3000;
const DID = /^did:[a-z]+:[A-Za-z0-9._:%-]{1,2048}$/;

export type DockMessage =
  | { readonly kind: "hello"; readonly origin: string }
  | { readonly kind: "ticket"; readonly ticket: string | null }
  | { readonly kind: "open"; readonly did: string }
  | { readonly kind: "shown"; readonly shown: boolean };

/** The box: the page's root with `?dock`, in a frame. */
export const isDock = (location: { pathname: string; search: string }, framed: boolean): boolean =>
  framed && location.pathname === "/" && new URLSearchParams(location.search).has("dock");

/**
 * What `event` says, or null when it is not from `parent`, not from `origin` once that is known, or not one of the
 * shell's shapes. Before the hello only the hello counts.
 */
export function dockMessage(
  event: MessageEvent,
  parent: MessageEventSource,
  origin: string | null,
): DockMessage | null {
  if (event.source === null || event.source !== parent) return null;
  if (origin !== null && event.origin !== origin) return null;
  const data = event.data as { type?: unknown; ticket?: unknown; did?: unknown; shown?: unknown } | null;
  if (typeof data !== "object" || data === null) return null;
  if (data.type === `${DOCK}hello`) return { kind: "hello", origin: event.origin };
  if (origin === null) return null;
  if (data.type === `${DOCK}ticket`) {
    if (data.ticket === null) return { kind: "ticket", ticket: null };
    return typeof data.ticket === "string" && data.ticket.length <= MAX_TICKET
      ? { kind: "ticket", ticket: data.ticket }
      : null;
  }
  if (data.type === `${DOCK}open` && typeof data.did === "string" && DID.test(data.did)) {
    return { kind: "open", did: data.did };
  }
  if (data.type === `${DOCK}shown` && typeof data.shown === "boolean") return { kind: "shown", shown: data.shown };
  return null;
}

/**
 * The one-time value's cookie, set by the box itself: the door's hop-state name, which its redeem reads, partitioned to
 * the box (CHIPS; a cookie a frame on another site sets is kept only with SameSite=None) and gone in ten minutes, as
 * the hop's is (interfaces/chat-auth cookies.ts HOP_MAX_AGE_S). The door clears it at redeem.
 */
export const stateCookie = (state: string): string =>
  `__Host-chat-state=${state}; Path=/; Max-Age=600; Secure; SameSite=None; Partitioned`;

/** The chat icon's number: the chats with new messages, and the requests waiting (ADR 0094's count, read here). */
export const unreadChats = (list: readonly Pick<Conversation, "available" | "request" | "unread">[]): number =>
  list.filter((c) => c.available && (c.request || c.unread > 0)).length;

/** Whether a page is seen, and the event that says it changed (the shape matrix/conversation-service.ts reads). */
type Visibility = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/**
 * The box as seen by the member: its tab is seen and the shell says the box is open. The shell hides the box with
 * its container, which leaves the box's own document "visible" (HTML "Page visibility",
 * https://html.spec.whatwg.org/multipage/interaction.html#page-visibility, read 2026-11-23: a document's visibility
 * follows its top-level traversable, not CSS), so without this a closed box would send read receipts for messages
 * nobody saw. It starts closed until the shell says otherwise (fail closed).
 */
export function boxVisibility(page: Visibility): Visibility & { setShown: (shown: boolean) => void } {
  const events = new EventTarget();
  let shown = false;
  const changed = () => events.dispatchEvent(new Event("visibilitychange"));
  page.addEventListener("visibilitychange", changed);
  return {
    get visibilityState(): DocumentVisibilityState {
      return shown && page.visibilityState === "visible" ? "visible" : "hidden";
    },
    addEventListener: events.addEventListener.bind(events) as Visibility["addEventListener"],
    removeEventListener: events.removeEventListener.bind(events) as Visibility["removeEventListener"],
    setShown(next) {
      if (next === shown) return;
      shown = next;
      changed();
    },
  };
}
