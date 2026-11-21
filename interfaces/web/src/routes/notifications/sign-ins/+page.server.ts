// GET and POST /notifications/sign-ins (P2.27c, ADR 0082): the member's sign-ins in the last 30 days, newest first,
// and the two delete forms. The gate has checked the session, onboarding, the confirmed email, the Origin, the body
// size and the notifications limit. Every statement names the member's DID, so an id from the form never reaches
// another member's row; an id already gone or someone else's deletes nothing, so each form is safe to send again.
// Any of the member's browsers may delete any entry (Alex 2026-11-21 00:57Z); book P2.28 adds a second check later.
import { type Actions, error, type RequestEvent, redirect, type ServerLoad } from "@sveltejs/kit";
import type { SignInsView } from "@unset/apps-web/lib/notifications/view.ts";
import { HISTORY_LIMIT, parseSignInId, parseSignInIds, type SignInHistory } from "@unset/domains-identity";
import { services } from "../../../lib/server/compose.ts";
import { single } from "../../../lib/server/theme.ts";
import type { ShellData } from "../../../lib/shell.ts";

const HOME = "/notifications/sign-ins";

/** The member's history: a request here never runs without a session (policy `required`). */
function history(event: RequestEvent): SignInHistory {
  if (event.locals.did === undefined) error(500, { message: "internal.error" });
  return services().signIns.history(event.locals.did, event.locals.deadline);
}

/** One more than the page shows, to know whether older ones exist. A failed read is a "failed" view, logged by class. */
async function signInsView(event: RequestEvent): Promise<SignInsView> {
  try {
    const rows = await history(event).list(HISTORY_LIMIT + 1);
    const entries = rows.slice(0, HISTORY_LIMIT).map((row) => ({ id: row.id, at: row.at.toISOString() }));
    return { state: "ready", entries, more: rows.length > HISTORY_LIMIT };
  } catch (failure) {
    services().log.warn("sign_ins.read_failed", { kind: failure instanceof Error ? failure.name : "unknown" });
    return { state: "failed" };
  }
}

export const load: ServerLoad = async (event) => {
  if (event.locals.did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  event.setHeaders({ "x-robots-tag": "noindex" });
  const shell: ShellData = { kind: "core", noindex: true, wide: true }; // the account button is the layout's
  return { shell, signIns: await signInsView(event) };
};

export const actions: Actions = {
  // One sign-in (its row's Delete) or the ticked ones (Delete selected). Ids that do not parse are dropped (rule DM-1).
  delete: async (event) => {
    const signIns = history(event);
    const form = await event.request.formData();
    const ids = parseSignInIds(form.getAll("id").filter((value) => typeof value === "string"));
    if (ids.length > 0) await signIns.remove(ids);
    redirect(303, HOME);
  },

  // The newest sign-in the page listed and every older one, never one after the page was drawn.
  deleteAll: async (event) => {
    const signIns = history(event);
    const upTo = parseSignInId(single(await event.request.formData(), "upTo"));
    if (upTo !== null) await signIns.removeUpTo(upTo);
    redirect(303, HOME);
  },
};
