// POST /privacy-notice/seen (P2.12b): the member dismisses the changed privacy notice banner, and the browser goes back
// where it was. The gate has checked the session, the app gate (so the account is finished), the method, the form
// type, the 2 KB body, the limits and the Origin. It records a seen version, never an acceptance (gates.ts).
import { type Actions, error, redirect, type ServerLoad } from "@sveltejs/kit";
import { safeReturnPath } from "@unset/shared-http";
import { services } from "../../../lib/server/compose.ts";
import { single } from "../../../lib/server/theme.ts";

// Not a page: a GET answers 405, as /prefs/theme does.
export const load: ServerLoad = () => error(405, "http.method_not_allowed");

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (locals.did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
    const form = await request.formData();
    const { accounts, versions } = services();
    // Only the version this build shows is recorded. A banner drawn before a newer notice was deployed names the older
    // one, and dismissing it must not hide the newer change, so that post writes nothing and the banner shows again.
    if (single(form, "version") === versions.privacy) {
      await accounts.markPrivacyNoticeSeen(locals.did, versions.privacy, locals.deadline);
    }
    redirect(303, safeReturnPath(single(form, "return")) ?? "/me");
  },
};
