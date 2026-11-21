// GET /@<handle> and /@<DID> (book P3.12s): a member's public profile, read from the index only, never from a PDS on
// request (ADR 0052). The index's view shows visible accounts alone (migration 0030), so an unknown actor, a path
// that is no actor, and a hidden, deactivated, deleted or erased account all get the same 404 (decision 35 D7, rule
// SE-2); a redirect would say the account exists, so it comes only after the account is found. A found account
// under any other path is sent to its canonical one (a verified handle, else the DID). Kept out of search results
// unless the member turned on "Search engines may list my page" (ADR 0062), whose title and description, when set,
// replace the name and headline in the page's title and description. With listing off on the whole site (P1.21b),
// server.ts and the root layout say noindex on this page too. No images until the media proxy (P3.09): the
// avatar is the letter, as on the owner's page.
import { error, redirect, type ServerLoad } from "@sveltejs/kit";
import { cardViews, contactAction, websiteLink } from "@unset/apps-web/lib/profile/view.ts";
import { canonicalActorPath, type Did, parseActor, parseDid, parseHandle } from "@unset/domains-identity";
import { CARDS_MAX, pageCards, readAvatarShape, readProfileRecord } from "@unset/domains-profile";
import { services } from "../../lib/server/compose.ts";
import { config } from "../../lib/server/runtime.ts";
import { accountLetter, type ShellData } from "../../lib/shell.ts";

/** A visitor's copy may be kept a minute (book P3.12 "Caching"), so a hidden account leaves caches within it. */
const PROFILE_CACHE = "public, max-age=60";
const SHELL: ShellData = { kind: "core", noindex: true, wide: true };
const LISTED_SHELL: ShellData = { kind: "core", wide: true };

/** The one not-found answer, never stored, so a member who appears is not hidden by a cached 404 (book P3.12). */
function missing(setHeaders: (headers: Record<string, string>) => void): never {
  setHeaders({ "cache-control": "no-cache", "x-robots-tag": "noindex" });
  error(404, "http.not_found");
}

export const load: ServerLoad = async ({ params, locals, url, setHeaders }) => {
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
  const { searchEngines, title, description } = found.discoverability;
  setHeaders(
    searchEngines ? { "cache-control": PROFILE_CACHE } : { "cache-control": PROFILE_CACHE, "x-robots-tag": "noindex" },
  );
  const cards = cardViews(pageCards(found.record, found.sections).slice(0, CARDS_MAX));
  return {
    shell: searchEngines ? LISTED_SHELL : SHELL,
    // What search results and link previews show: only what the page itself shows, or the member's own overrides.
    meta: {
      title: title || name,
      description: description || fields.headline,
      url: `${config.PUBLIC_ORIGIN}${canonical}`,
    },
    did,
    handle,
    name,
    letter: accountLetter(name),
    headline: fields.headline,
    location: fields.location,
    website: websiteLink(fields.website),
    avatarShape: readAvatarShape(found.record),
    // At most what the owner's own page reads (infrastructure/pds card-records.ts MAX_CARDS): the index may hold up to
    // twice that (MAX_SECTIONS_PER_ACCOUNT), and a visitor never sees more cards than the member does.
    cards,
    // The header's About panel repeats the page's own contact action (ADR 0072); nothing the page does not show.
    contact: contactAction(cards),
    // Build step 10 (ADR 0082 decision 6, ADR 0090 decision 3): into the chat page by DID, the same for every visitor.
    message: `${config.CHAT_DOOR_ORIGIN}/dm/${did}`,
  };
};
