// Settings › Profile (P2.13c): the profile's fields read from the member's own PDS, for the form that posts to /profile
// (routes/profile, the one profile save; it comes back here). The gate has already sent a signed-out visitor to
// /login (policy.ts) and set the app page's private, no-store and Vary: Cookie. The DID is the session's, never the
// request's (SE-2). Every stored field is checked on the way in (domains/profile readProfileRecord): one another client
// wrote badly reads as empty. A dead grant sends the member to sign in; any other failed read shows no form.
import { error, redirect, type ServerLoad } from "@sveltejs/kit";
import { APP_LIMITS, EMPTY_PROFILE, type ProfileFields, readProfileRecord } from "@unset/domains-profile";
import { loadProfileRecord } from "@unset/infrastructure-pds";
import { services } from "../../../lib/server/compose.ts";
import { respondToPdsFailure } from "../../../lib/server/pds-failure.ts";
import { config } from "../../../lib/server/runtime.ts";
import { settingsShell } from "../shell.server.ts";

export const load: ServerLoad = async ({ locals, request, setHeaders }) => {
  setHeaders({ "x-robots-tag": "noindex" });
  const did = locals.did;
  if (did === undefined) error(500, { message: "internal.error" }); // the gate let no session through
  const ctx = { memo: new Map(), deadline: locals.deadline, deadlineAt: locals.deadlineAt };
  const read = await loadProfileRecord(services().pds.pdsCall, ctx, did);
  let profile: ProfileFields | null = null;
  if (read.kind === "ok") {
    profile = read.value === null ? EMPTY_PROFILE : readProfileRecord(read.value.value);
  } else {
    const failure = respondToPdsFailure("GET", read, config.PDS_HOSTNAME);
    if (failure.action === "redirect") redirect(303, failure.location);
  }
  return {
    shell: settingsShell(request, "/settings/profile"),
    profile,
    limits: APP_LIMITS,
    pagePath: `/${did}`,
  };
};
