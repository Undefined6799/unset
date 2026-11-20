// Settings › Profile (P2.13c): the profile's fields read from the member's own PDS, for the form that posts to /profile
// (routes/profile, the one profile save; it comes back here). The gate has already sent a signed-out visitor to
// /login (policy.ts) and set the app page's private, no-store and Vary: Cookie. The DID is the session's, never the
// request's (SE-2). Every stored field is checked on the way in (domains/profile readProfileRecord): one another client
// wrote badly reads as empty. A dead grant sends the member to sign in; any other failed read shows no form.
import { error, redirect, type ServerLoad } from "@sveltejs/kit";
import {
  APP_LIMITS,
  DISCOVERABILITY_LIMITS,
  EMPTY_PROFILE,
  type ProfileFields,
  readProfileRecord,
} from "@unset/domains-profile";
import { loadProfileRecord } from "@unset/infrastructure-pds";
import { services } from "../../../lib/server/compose.ts";
import { pdsSignInRedirect } from "../../../lib/server/pds-failure.ts";
import { config } from "../../../lib/server/runtime.ts";
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
  let profile: ProfileFields | null = null;
  if (read.kind === "ok") {
    const stored = read.value?.value;
    profile = stored === undefined ? EMPTY_PROFILE : readProfileRecord(stored);
  } else {
    const location = pdsSignInRedirect(read);
    if (location !== null) redirect(303, location);
  }
  return {
    shell: settingsShell(request, "/settings/profile"),
    profile,
    limits: APP_LIMITS,
    pagePath: `/${did}`,
    // The Search and AI section (ADR 0062), kept in our database, so it shows even when the PDS did not answer.
    discoverability,
    discoverabilityLimits: DISCOVERABILITY_LIMITS,
    // The profile save's 303 back here (routes/profile/save.server.ts): with no script, the page says it saved.
    saved: url.searchParams.has("saved"),
    // Listing switched off on the whole site (P1.21b): the section says so, and the choices still save.
    searchListingOff: config.SEARCH_LISTING !== "on",
  };
};
