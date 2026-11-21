// GET and POST /notifications (P2.27, ADR 0079 and 0081): the member's inbox, newest first, and the two forms the page
// and the bell post. The gate has checked the session, onboarding, the confirmed email, the Origin, the body size and
// the notifications limit. Viewing deletes nothing, and neither does showing an entry's detail (`?n=`, a link): an
// entry stays until it is dismissed. Viewing marks the list seen in this browser, so the badge counts only newer
// entries (ADR 0085), as opening the bell does with the `seen` form. Each form is safe to send again: an id already gone, another member's, or one
// this browser may not see deletes nothing.
import { type Actions, error, type RequestEvent, redirect, type ServerLoad } from "@sveltejs/kit";
import {
  type Inbox,
  type NotificationId,
  PAGE_LIMIT,
  parseNotificationId,
  parseNotificationIds,
} from "@unset/domains-notifications";
import { safeReturnPath } from "@unset/shared-http";
import { services } from "../../lib/server/compose.ts";
import { dismissed } from "../../lib/server/notification-sources.ts";
import { inboxOf, notificationsView } from "../../lib/server/notifications.ts";
import { single } from "../../lib/server/theme.ts";
import type { ShellData } from "../../lib/shell.ts";

export const load: ServerLoad = async (event) => {
  if (event.locals.did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  event.setHeaders({ "x-robots-tag": "noindex" });
  const shell: ShellData = { kind: "core", noindex: true, wide: true, account: { path: `/${event.locals.did}` } };
  const notifications = await notificationsView(event, PAGE_LIMIT);
  const newest = parseNotificationId(notifications?.state === "ready" ? (notifications.entries[0]?.id ?? null) : null);
  if (newest !== null) await markSeen(event, newest);
  return { shell, notifications };
};

/**
 * Best effort: a failed mark is a warning with its error class only, and the page shows as it would; the badge then
 * counts the entries again on the next page.
 */
async function markSeen(event: RequestEvent, upTo: NotificationId): Promise<void> {
  try {
    await inbox(event).markSeen(upTo);
  } catch (error) {
    services().log.warn("notifications.mark_seen_failed", { kind: error instanceof Error ? error.name : "unknown" });
  }
}

/** The inbox the gate's session opens: a POST here never runs without one (policy `required`). */
function inbox(event: RequestEvent): Inbox {
  const found = inboxOf(event);
  if (found === undefined) error(500, { message: "internal.error" });
  return found;
}

const member = (event: RequestEvent) => {
  if (event.locals.did === undefined) error(500, { message: "internal.error" });
  return event.locals.did;
};

export const actions: Actions = {
  // The entries a form names: one (the detail's Dismiss) or those ticked (Dismiss selected). Ids that do not parse are
  // dropped (rule DM-1); none at all dismisses nothing. Back to the list, or where the form says.
  dismiss: async (event) => {
    const box = inbox(event);
    const form = await event.request.formData();
    const ids = parseNotificationIds(form.getAll("id").filter((value) => typeof value === "string"));
    if (ids.length > 0) await dismissed(member(event), await box.dismiss(ids), event.locals.deadline);
    redirect(303, safeReturnPath(single(form, "return")) ?? "/notifications");
  },

  // The bell was opened (with script, ADR 0085): what it showed, its newest entry and every older one, is seen in this
  // browser. An id it may not see marks nothing.
  seen: async (event) => {
    const box = inbox(event);
    const upTo = parseNotificationId(single(await event.request.formData(), "upTo"));
    if (upTo !== null) await box.markSeen(upTo);
    redirect(303, "/notifications");
  },

  // Everything the list showed: its newest entry and every older one, never one sent after it was drawn.
  dismissAll: async (event) => {
    const box = inbox(event);
    const form = await event.request.formData();
    const upTo = parseNotificationId(single(form, "upTo"));
    if (upTo !== null) await dismissed(member(event), await box.dismissUpTo(upTo), event.locals.deadline);
    redirect(303, safeReturnPath(single(form, "return")) ?? "/notifications");
  },
};
