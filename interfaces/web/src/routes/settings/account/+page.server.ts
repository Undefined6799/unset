// Settings › Account (P2.13c): the checked handle, the DID, the sign-in server link and the two sign-out forms. The
// gate has already sent a signed-out visitor to /login (policy.ts); the DID is the session's, never the request's.
import { error, type ServerLoad } from "@sveltejs/kit";
import { services } from "../../../lib/server/compose.ts";
import { settingsShell } from "../shell.server.ts";
import { type AccountDeps, accountView } from "./account.server.ts";

function accountDeps(): AccountDeps {
  const { handles, issuerOf, pdsIssuer, log } = services();
  return {
    verifyHandle: (did, signal) => handles.verifyHandle(did, { signal }),
    issuerOf: (did, signal) => issuerOf(did, signal),
    pdsIssuer,
    log,
  };
}

export const load: ServerLoad = async ({ locals, setHeaders }) => {
  setHeaders({ "x-robots-tag": "noindex" });
  if (locals.did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  const view = await accountView(accountDeps(), locals.did, locals.issuerOrigin, locals.deadline);
  return {
    ...view,
    shell: settingsShell(locals),
    // FALLBACK until locals carry the gate's privacyNotice (P1.20f): no notice is shown.
    privacyNotice: false,
  };
};
