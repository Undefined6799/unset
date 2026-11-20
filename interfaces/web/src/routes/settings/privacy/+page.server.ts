// Settings › Privacy (P1.21y): the member's Search and AI choices (ADR 0062), kept in our database, and what their
// public page shows when the search title and description are empty, for the preview: the page's address, the
// profile's name and headline read from the member's own PDS. The gate has already sent a signed-out visitor to
// /login (policy.ts) and set the app page's private, no-store and Vary: Cookie. The DID is the session's, never the
// request's (SE-2). The choices show even when the PDS did not answer; the preview then names the member by handle
// or DID, as the public page does with no name. A dead grant sends the member to sign in.
import { error, redirect, type ServerLoad } from "@sveltejs/kit";
import { canonicalActorPath } from "@unset/domains-identity";
import { DISCOVERABILITY_LIMITS, EMPTY_PROFILE, readProfileRecord } from "@unset/domains-profile";
import { loadProfileRecord } from "@unset/infrastructure-pds";
import { services } from "../../../lib/server/compose.ts";
import { pdsSignInRedirect } from "../../../lib/server/pds-failure.ts";
import { config } from "../../../lib/server/runtime.ts";
import { accountLetter } from "../../../lib/shell.ts";
import { settingsShell } from "../shell.server.ts";

export const load: ServerLoad = async ({ locals, request, setHeaders, url }) => {
  setHeaders({ "x-robots-tag": "noindex" });
  const did = locals.did;
  if (did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  const ctx = { memo: new Map(), deadline: locals.deadline, deadlineAt: locals.deadlineAt };
  const [read, discoverability] = await Promise.all([
    loadProfileRecord(services().pds.pdsCall, ctx, did),
    services().discoverability.get(did, locals.deadline),
  ]);
  if (read.kind !== "ok") {
    const location = pdsSignInRedirect(read);
    if (location !== null) redirect(303, location);
  }
  const stored = read.kind === "ok" ? read.value?.value : undefined;
  const fields = stored === undefined ? EMPTY_PROFILE : readProfileRecord(stored);
  // As the public page names it (routes/@[actor]/+page.server.ts): the verified handle, else the DID.
  const handle = services().handles.verifiedHandle(did);
  const name = fields.displayName || handle || did;
  return {
    shell: settingsShell(request, "/settings/privacy"),
    discoverability,
    limits: DISCOVERABILITY_LIMITS,
    page: {
      url: `${config.PUBLIC_ORIGIN}${canonicalActorPath(handle, did)}`,
      name,
      headline: fields.headline,
      letter: accountLetter(name),
    },
    // The Search and AI save's 303 back here (routes/settings/search-and-ai): with no script, the page says it saved.
    saved: url.searchParams.has("saved"),
    // Listing switched off on the whole site (P1.21b): the section says so, and the choices still save.
    searchListingOff: config.SEARCH_LISTING !== "on",
  };
};
