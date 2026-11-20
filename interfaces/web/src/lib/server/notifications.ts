// The member's notifications on web (P2.27, ADR 0079): the domain's inbox for this request's browser session, shaped
// as the screens' view type. A failed read is a "failed" view and a warning with its error class only, so a database
// blip costs the bell its list and never the page around it.
import type { RequestEvent } from "@sveltejs/kit";
import type { REASON_SCREENS } from "@unset/apps-web/lib/notifications/reasons.ts";
import type { NotificationsView } from "@unset/apps-web/lib/notifications/view.ts";
import { type Inbox, inboxList, type Reason } from "@unset/domains-notifications";
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

/** Up to `limit` notifications for the browser's session, or undefined for a request with none. */
export async function notificationsView(event: RequestEvent, limit: number): Promise<NotificationsView | undefined> {
  const inbox = inboxOf(event);
  if (inbox === undefined) return undefined;
  try {
    const list = await inboxList(inbox, limit);
    const entries = list.entries.map((e) => ({ id: e.id, reason: e.reason, sentAt: e.sentAt.toISOString() }));
    return { state: "ready", entries, unread: list.unread, more: list.more };
  } catch (error) {
    services().log.warn("notifications.read_failed", { kind: error instanceof Error ? error.name : "unknown" });
    return { state: "failed" };
  }
}
