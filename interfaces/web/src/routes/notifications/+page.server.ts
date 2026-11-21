// GET and POST /notifications (P2.27, ADR 0079): the member's inbox, newest first, and the two forms the bell and this
// page post. The gate has checked the session, onboarding, the confirmed email, the Origin, the body size and the
// notifications limit. Viewing never changes anything; opening an entry or marking all as read deletes, and each is
// safe to send again: an id already gone, another member's, or one this browser may not see deletes nothing.
import { type Actions, error, type RequestEvent, redirect, type ServerLoad } from "@sveltejs/kit";
import { reasonScreen } from "@unset/apps-web/lib/notifications/reasons.ts";
import { type Inbox, PAGE_LIMIT, parseNotificationId } from "@unset/domains-notifications";
import { safeReturnPath } from "@unset/shared-http";
import { opened } from "../../lib/server/notification-sources.ts";
import { inboxOf, notificationsView } from "../../lib/server/notifications.ts";
import { single } from "../../lib/server/theme.ts";
import type { ShellData } from "../../lib/shell.ts";

export const load: ServerLoad = async (event) => {
  if (event.locals.did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  event.setHeaders({ "x-robots-tag": "noindex" });
  const shell: ShellData = { kind: "core", noindex: true, account: { path: `/${event.locals.did}` } };
  return { shell, notifications: await notificationsView(event, PAGE_LIMIT) };
};

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
  // One entry: it is deleted, then the browser goes to its reason's page. A form that names nothing this browser may
  // open goes back to the list (rule DM-1).
  open: async (event) => {
    const box = inbox(event);
    const id = parseNotificationId(single(await event.request.formData(), "id"));
    const entry = id === null ? null : await box.open(id);
    if (entry !== null) await opened(member(event), [entry], event.locals.deadline);
    redirect(303, (entry === null ? undefined : reasonScreen(entry.reason)?.href) ?? "/notifications");
  },

  // Everything the list showed: its newest entry and every older one. Back where it was sent.
  readAll: async (event) => {
    const box = inbox(event);
    const form = await event.request.formData();
    const upTo = parseNotificationId(single(form, "upTo"));
    if (upTo !== null) await opened(member(event), await box.openUpTo(upTo), event.locals.deadline);
    redirect(303, safeReturnPath(single(form, "return")) ?? "/notifications");
  },
};
