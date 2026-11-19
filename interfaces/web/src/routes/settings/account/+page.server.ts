// Settings › Account (P2.13c): the checked handle, the DID, the sign-in server link and the two sign-out forms. The
// gate has already sent a signed-out visitor to /login (policy.ts); the DID is the session's, never the request's.
import { error, type ServerLoad } from "@sveltejs/kit";
import { accountView } from "../../../lib/server/account.ts";
import { services } from "../../../lib/server/compose.ts";
import { settingsShell } from "../shell.server.ts";

export const load: ServerLoad = async ({ locals, request, setHeaders }) => {
  setHeaders({ "x-robots-tag": "noindex" });
  if (locals.did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  const view = await accountView(services(), locals.did, locals.issuerOrigin, locals.deadline);
  return {
    ...view,
    shell: settingsShell(request, "/settings/account"),
    // The one-time banner after a privacy notice change (P2.12), as the gate decided it.
    privacyNotice: locals.privacyNotice,
  };
};
