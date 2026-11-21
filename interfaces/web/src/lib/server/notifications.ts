// The member's notifications on web (P2.27, ADR 0079): the domain's inbox for this request's browser session, shaped
// as the screens' view type. A failed read is a "failed" view and a warning with its error class only, so a database
// blip costs the bell its list and never the page around it.
import type { RequestEvent } from "@sveltejs/kit";
import type { REASON_SCREENS } from "@unset/apps-web/lib/notifications/reasons.ts";
import type { NotificationsView } from "@unset/apps-web/lib/notifications/view.ts";
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
 * The bell, from the entries the session read brought (infrastructure/session/store.ts), so a page spends no
 * statement of its own on it; a session read without them reads the inbox instead.
 */
export async function bellView(event: RequestEvent): Promise<NotificationsView | undefined> {
  const inbox = gateSession(event)?.inbox;
  const view =
    inbox === undefined || event.locals.did === undefined
      ? await notificationsView(event, BELL_LIMIT)
      : viewOf(listOf(inbox, BELL_LIMIT));
  // The notifications page marks its list seen as it loads (ADR 0085), after the session read this view comes from, so
  // the bell on that page reads nothing waiting.
  return view?.state === "ready" && event.route.id === NOTIFICATIONS_PAGE ? { ...view, count: 0 } : view;
}
