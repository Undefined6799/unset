// GET and POST /notifications (P2.27, ADR 0079): the member's notifications, newest first, and the two forms the bell
// and this page post. The gate has checked the session, onboarding, the confirmed email, the Origin, the body size
// and the notifications limit. Viewing never changes anything; opening an entry or marking all as read does, and
// each is safe to send again: a time only moves forward (store.ts markSignInsSeen) and a seen version is only
// recorded when it is this build's (P2.12b).
import { type Actions, error, type RequestEvent, redirect, type ServerLoad } from "@sveltejs/kit";
import { PAGE_LIMIT, parseSignInAt } from "@unset/domains-notifications";
import { safeReturnPath } from "@unset/shared-http";
import { services } from "../../lib/server/compose.ts";
import { notificationsView } from "../../lib/server/notifications.ts";
import { gateSession } from "../../lib/server/session.ts";
import { single } from "../../lib/server/theme.ts";
import type { ShellData } from "../../lib/shell.ts";

/** Where an opened entry leads: a sign-in to where the member can sign out everywhere, the notice to the notice. */
const TARGET = { sign_in: "/settings/account", privacy_notice: "/legal/privacy" } as const;

export const load: ServerLoad = async (event) => {
  if (event.locals.did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  event.setHeaders({ "x-robots-tag": "noindex" });
  const shell: ShellData = { kind: "core", noindex: true, account: { path: `/${event.locals.did}` } };
  return { shell, notifications: await notificationsView(event, PAGE_LIMIT) };
};

/** The session the gate read: a POST here never runs without one (policy `required`). */
function browser(event: RequestEvent) {
  const session = gateSession(event);
  if (session === undefined || event.locals.did === undefined) error(500, { message: "internal.error" });
  return session;
}

/** Records the notice as seen when the form names this build's version; any other version records nothing. */
async function seeNotice(event: RequestEvent, version: string | null): Promise<void> {
  const { accounts, versions } = services();
  const did = event.locals.did;
  if (did !== undefined && version === versions.privacy) {
    await accounts.markPrivacyNoticeSeen(did, versions.privacy, event.locals.deadline);
  }
}

export const actions: Actions = {
  // One entry: it is marked opened, then the browser goes to what it is about. A form that names nothing valid goes
  // back to the list and changes nothing (rule DM-1).
  open: async (event) => {
    const session = browser(event);
    const form = await event.request.formData();
    const kind = single(form, "kind");
    if (kind === "sign_in") {
      const at = parseSignInAt(single(form, "at"));
      if (at === null) redirect(303, "/notifications");
      await services().signIns.markSeen(session.idHash, at, event.locals.deadline);
      redirect(303, TARGET.sign_in);
    }
    if (kind === "privacy_notice") {
      await seeNotice(event, single(form, "version"));
      redirect(303, TARGET.privacy_notice);
    }
    redirect(303, "/notifications");
  },

  // Everything the list showed: the newest sign-in (and so every older one) and the notice. Back where it was sent.
  readAll: async (event) => {
    const session = browser(event);
    const form = await event.request.formData();
    const at = parseSignInAt(single(form, "at"));
    if (at !== null) await services().signIns.markSeen(session.idHash, at, event.locals.deadline);
    await seeNotice(event, single(form, "version"));
    redirect(303, safeReturnPath(single(form, "return")) ?? "/notifications");
  },
};
