// The member's notifications on web (P2.27, ADR 0079): the domain's list, bound to this request's browser session,
// shaped as the screens' view type. A failed read is a "failed" view and a warning with its error class only, so a
// database blip costs the bell its list and never the page around it.
import type { RequestEvent } from "@sveltejs/kit";
import type { NotificationsView } from "@unset/apps-web/lib/notifications/view.ts";
import { COUNT_CAP, notificationsFor, type SignInAt } from "@unset/domains-notifications";
import { services } from "./compose.ts";
import { gateSession } from "./session.ts";

/** How many newer sign-ins the session read brings with it (compose.ts): what the bell asks for. */
export const SIGN_INS_WITH_SESSION = COUNT_CAP + 1;

/** Up to `limit` notifications for the browser's session, or undefined for a request the gate read none for. */
export async function notificationsView(event: RequestEvent, limit: number): Promise<NotificationsView | undefined> {
  const session = gateSession(event);
  if (session === undefined) return undefined;
  const { signIns, versions, log } = services();
  const { deadline } = event.locals;
  try {
    const list = await notificationsFor(
      {
        // The store gives each time in the exact shape the domain's SignInAt names (store.ts newerSignIns). The bell's
        // few came with the session read, so it runs no statement of its own; the page asks for more.
        signIns: async (n) =>
          (n <= SIGN_INS_WITH_SESSION && session.newerSignIns !== undefined
            ? session.newerSignIns.slice(0, n)
            : await signIns.since(session.idHash, n, deadline)) as SignInAt[],
        privacyNotice: event.locals.privacyNotice ? versions.privacy : null,
      },
      limit,
    );
    return { state: "ready", entries: list.entries, unread: list.unread, more: list.more };
  } catch (error) {
    log.warn("notifications.read_failed", { kind: error instanceof Error ? error.name : "unknown" });
    return { state: "failed" };
  }
}
