// The member's notifications on web (P2.27, ADR 0079): the domain's inbox for this request's browser session, shaped
// as the screens' view type. A failed read is a "failed" view and a warning with its error class only, so a database
// blip costs the bell its list and never the page around it.
import type { RequestEvent } from "@sveltejs/kit";
import type { REASON_SCREENS } from "@unset/apps-web/lib/notifications/reasons.ts";
import type { BellView, NotificationsView } from "@unset/apps-web/lib/notifications/view.ts";
import {
  BELL_LIMIT,
  type Entry,
  type Inbox,
  inboxList,
  listOf,
  type NotificationList,
  type Reason,
} from "@unset/domains-notifications";
import { services } from "./compose.ts";
import { gateSession } from "./session.ts";

// The screens' reason table and the domain's REASONS name the same reasons: a reason added to one and not the other
// fails the build here (ADR 0079 point 2).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const reasonsMatch: Same<keyof typeof REASON_SCREENS, Reason> = true;
void reasonsMatch;

/** The inbox as this request's browser may see it, or undefined for a request the gate read no session for. */
export function inboxOf(event: RequestEvent): Inbox | undefined {
  const session = gateSession(event);
  if (session === undefined || event.locals.did === undefined) return undefined;
  return services().notifications.inbox(event.locals.did, session.idHash, event.locals.deadline);
}

const viewOf = (list: NotificationList): NotificationsView => ({
  state: "ready",
  entries: list.entries.map((e: Entry) => ({ id: e.id, reason: e.reason, sentAt: e.sentAt.toISOString() })),
  count: list.count,
  more: list.more,
});

/** Up to `limit` notifications for the browser's session, or undefined for a request with none. */
export async function notificationsView(event: RequestEvent, limit: number): Promise<NotificationsView | undefined> {
  const inbox = inboxOf(event);
  if (inbox === undefined) return undefined;
  try {
    return viewOf(await inboxList(inbox, limit));
  } catch (error) {
    services().log.warn("notifications.read_failed", { kind: error instanceof Error ? error.name : "unknown" });
    return { state: "failed" };
  }
}

/** The notifications page's route id. */
const NOTIFICATIONS_PAGE = "/notifications";

/**
 * Whether this load of the notifications page marks its list seen (ADR 0085): only a visit the member made, from our
 * own pages or by typing the address, and never a prefetch. With SameSite=Lax the session cookie also goes on a
 * top-level navigation from another site, which must not clear a new-sign-in badge (review of #1910). Fetch Metadata
 * says where a request came from: `Sec-Fetch-Site` is "same-origin" for our own links and client navigations and
 * "none" for a typed address or a bookmark (https://w3c.github.io/webappsec-fetch-metadata/,
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site; sent by Chrome 76+, Firefox
 * 90+ and Safari 16.4+, read 2026-11-21); a request without it marks nothing. A prefetch says so in `Sec-Purpose`
 * ("prefetch", the one value MDN defines: .../Headers/Sec-Purpose). A `prerender` value and the older `Purpose` header
 * are refused too, unverified against a browser's docs: refusing them costs nothing but a mark.
 */
export function viewMarksSeen(event: RequestEvent): boolean {
  if (event.route.id !== NOTIFICATIONS_PAGE || event.request.method !== "GET") return false;
  const headers = event.request.headers;
  const site = headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") return false;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`;
  return !/prefetch|prerender/i.test(purpose);
}

/**
 * The bell, from the entries the session read brought (infrastructure/session/store.ts), so a page spends no
 * statement of its own on it; a session read without them reads the inbox instead. `opens` says whether the document
 * runs the client, which draws the entries in the bell's panel; a document that runs none shows the count on a link,
 * so it is sent the count and no entry (book P1.22g, rule SE-3).
 */
export async function bellView(event: RequestEvent, opens: boolean): Promise<BellView | undefined> {
  const inbox = gateSession(event)?.inbox;
  const view =
    inbox === undefined || event.locals.did === undefined
      ? await notificationsView(event, BELL_LIMIT)
      : viewOf(listOf(inbox, BELL_LIMIT));
  if (view?.state !== "ready") return view;
  // The notifications page marks its list seen as it loads (ADR 0085), after the session read this view comes from, so
  // the bell on that page reads nothing waiting whenever the page marks it.
  const count = viewMarksSeen(event) ? 0 : view.count;
  return opens ? { ...view, count } : { state: "count", count };
}
