// GET /@<handle> and /@<DID> (book P3.12s): a member's public profile, read from the index only, never from a PDS on
// request (ADR 0052). The index's view shows visible accounts alone (migration 0030), so an unknown actor, a path
// that is no actor, and a hidden, deactivated, deleted or erased account all get the same 404 (decision 35 D7, rule
// SE-2); a redirect would say the account exists, so it comes only after the account is found. A found account
// under any other path is sent to its canonical one (a verified handle, else the DID). Kept out of search results
// until the member's "Search and AI" choice exists (plan review 2026-11-18 §7.4). No images until the media proxy
// (P3.09): the avatar is the letter, as on the owner's page.
import { error, redirect, type ServerLoad } from "@sveltejs/kit";
import { cardViews, websiteLink } from "@unset/apps-web/lib/profile/view.ts";
import { canonicalActorPath, type Did, parseActor, parseDid, parseHandle } from "@unset/domains-identity";
import { pageCards, readAvatarShape, readProfileRecord } from "@unset/domains-profile";
import { services } from "../../lib/server/compose.ts";
import { config } from "../../lib/server/runtime.ts";
import { accountLetter, type ShellData } from "../../lib/shell.ts";

/** A visitor's copy may be kept a minute (book P3.12 "Caching"), so a hidden account leaves caches within it. */
const PROFILE_CACHE = "public, max-age=60";
const SHELL: ShellData = { kind: "core", noindex: true, wide: true };

/** The one not-found answer, never stored, so a member who appears is not hidden by a cached 404 (book P3.12). */
function missing(setHeaders: (headers: Record<string, string>) => void): never {
  setHeaders({ "cache-control": "no-cache" });
  error(404, "http.not_found");
}

export const load: ServerLoad = async ({ params, locals, url, setHeaders }) => {
  setHeaders({ "x-robots-tag": "noindex" });
  const actor = parseActor(params.actor ?? "", config.HANDLE_SUFFIX);
  if (actor === null) missing(setHeaders);
  const found = await services().publicProfiles.find(actor, locals.deadline);
  // The index holds only DIDs and handles it parsed; one that no longer parses is shown as missing, never guessed.
  const did: Did | null = found === null ? null : parseDid(found.did);
  if (found === null || did === null) missing(setHeaders);
  const handle = found.handle === null ? null : parseHandle(found.handle);
  const canonical = canonicalActorPath(handle, did);
  if (url.pathname !== canonical) redirect(301, canonical);

  const fields = readProfileRecord(found.record);
  const name = fields.displayName || handle || did;
  setHeaders({ "cache-control": PROFILE_CACHE });
  return {
    shell: SHELL,
    did,
    handle,
    name,
    letter: accountLetter(name),
    headline: fields.headline,
    location: fields.location,
    website: websiteLink(fields.website),
    avatarShape: readAvatarShape(found.record),
    cards: cardViews(pageCards(found.record, found.sections)),
  };
};
