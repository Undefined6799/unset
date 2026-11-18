// Settings › Account (P2.13c): the checked handle, the DID, the sign-in server link and the two sign-out forms. The
// gate has already sent a signed-out visitor to /login (policy.ts); the DID is the session's, never the request's.
import { error } from "@sveltejs/kit";
import { parseDid } from "@unset/domains-identity";
import { services } from "../../../lib/server/compose.ts";
import type { PageServerLoad } from "./$types";
import { type AccountDeps, accountView } from "./account.server.ts";

/** The services the view reads; the OAuth and identity services are P1.20e's (compose.ts). */
function accountDeps(): AccountDeps {
  const { handles, oauth, pdsIssuer, log } = services();
  return {
    verifyHandle: (did, signal) => handles.verifyHandle(did, { signal }),
    issuerOf: (did, signal) => oauth.issuerOf(did, signal),
    pdsIssuer,
    log,
  };
}

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  // FALLBACK until the gate sets these on every app page (asked of the integration lane): delete with it.
  setHeaders({ "cache-control": "private, no-store", vary: "Cookie" });
  const did = parseDid(locals.did ?? "");
  if (did === null) error(500, { message: "internal.error" }); // the gate let no session through: never guess one
  // FALLBACK until locals carry the session's issuerOrigin and privacyNotice (P1.20f): the token set is read instead,
  // and no notice is shown.
  const view = await accountView(accountDeps(), did, undefined, locals.deadline);
  return { ...view, privacyNotice: false };
};
