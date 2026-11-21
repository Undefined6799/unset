# 0078 — The member chooses who sees their page

Status: Accepted by Alex, 2026-11-21 01:32Z, against 7a73c61 (his line naming that head, given after it was reviewed;
merged as 0f5901a). This status paragraph, the index rows and the ADR 0001 acceptance line were added afterwards. ADR
0004's and ADR 0002's own status lines are left as they were: an accepted ADR may change only to "Superseded by NNNN",
which would overstate a partial supersession, so the index and the ADR 0001 log record it. Step P1.22a. Partly
supersedes ADR 0004 (decision 37) and decision 35 D7 (ADR 0002) for the profile page, as Decision 6 says.

## Context

Alex, 2026-11-20 19:35Z: "we could offer to not show the page to unsigned in user and discourage like the discovery of
their page ... like Blue Sky does, but then like put like a disclaimer that like their profile will always remain
available publicly on the At Proto network." At 19:43Z and 19:45Z he asked for three levels: a public page, a page for
signed-in members only, and one that "only the user gets to see". At 19:46Z: someone left out should not see a missing
account but "some kind of a message there to say that it's a user ... minimum information about his account", because
the member may be active elsewhere on unset.sh. At 19:55Z he did not see this as a false sense of privacy and asked for a
question mark beside each choice that opens the whole explanation.

What atproto offers: Bluesky's self-label `!no-unauthenticated` on `app.bsky.actor.profile` asks apps to hide the
account from signed-out viewers (`@atproto/api` 0.30.3, `dist/moderation/const/labels.js`, flags `no-override` and
`unauthed`; `dist/moderation/subjects/account.js`, `filterAccountLabels` keeps that one self-label from the profile
record). Bluesky reads it only from its own profile record, which our sign-in grant cannot write (it covers `sh.unset.*`
only), and atproto defines no value for "only the member". Every record stays readable by anyone from the member's PDS
and the relays (https://atproto.com/specs/repository).

## Decision

1. `sh.unset.profile.visibility` is an optional string, at most 32 UTF-8 bytes, with known values `public`, `signedIn`
   and `ownerOnly`. Absent means `public`, so every stored profile keeps its page. An unknown valid value reads as
   `ownerOnly`, the most closed level, so a newer client's choice is never shown more widely than its owner meant
   (`domains/profile` `readProfileVisibility`). A save writes only a known value; choosing `public` removes the field;
   a save that does not send it keeps the stored value.
2. Settings › Privacy holds one form with the choice as native radios and, under Public, the Search and AI fields
   (ADR 0062), shown only while Public is ticked (Alex, 20:26Z), by CSS from the checked radio, so it works with no
   script. It posts to `POST /settings/search-and-ai`, the path ADR 0062 named: the choice is written to the profile
   record on the member's PDS first, then the Search and AI choices are saved, only while the choice is public; a
   page not shown to everyone keeps its stored choices. The labels are "Public", "Signed-in members only" and "Only
   me", in one place (`apps/web/lib/settings/messages.ts` `PAGE_VISIBILITY`); the stored values never change with
   them. Never the word "private" for a choice. A short disclaimer stays in view under the choices: this asks apps not
   to show the page and does not hide the profile on the network. Each choice's question mark opens its one-line
   explanation in a native popover (Alex, 20:26Z: nothing longer for now; a link to member documentation can come
   later).
3. `/@<actor>` reads an optional session (the `optional` policy the home and legal pages use: a page rendered for a
   member is private and never stored; every answer varies on Cookie). What each viewer gets (`pageShownTo`):

   | | Public | Signed-in members only | Only me |
   | --- | --- | --- | --- |
   | Not signed in | page | limited, with Sign in | limited |
   | Another member | page | page | limited |
   | The member | page | page | page |

   The limited page shows, in one card centered on the page (Alex, 20:49Z), the avatar, display name, handle and DID and
   one sentence, with no headline, details, cards, description, canonical link or link-preview tags, and says noindex in
   the page and in `X-Robots-Tag`. A whole page that is not public says above it who sees it.
4. A page that is not public is never offered to search engines or AI search, whatever its Search and AI choices
   (ADR 0062) say: noindex, out of the sitemap, and no AI search Allow line in robots.txt (`publicProfileStore`'s
   listing queries keep only records with no `visibility` or `public`). The choices are kept until the page is public
   again. Search crawlers are not disallowed, so they can
   fetch the limited page and read its noindex; a blocked crawler would keep a stale result. Search engines usually drop
   a page within days to a few weeks; copies others made can remain, which the help says.
5. The indexer keeps the field as it keeps any profile field; no migration, column or new personal data.
6. This partly supersedes two accepted decisions, for the profile page only. ADR 0004 (decision 37): "Whatever the
   network can already show about a member ... unset.sh shows too". With these levels unset.sh hides a page whose
   records the network still shows, as Bluesky does, and says so beside the choice. And decision 35 D7 (ADR 0002): "A
   private profile answers like a missing one". The limited page shows that the account exists. What it shows is
   already public: the handle resolves in DNS or `.well-known` and the DID in the PLC directory, so it reveals nothing
   the network does not. Both rules still hold everywhere else: the read API, the directory and chat lookup. On
   acceptance, the status lines of ADR 0004 and ADR 0002 gain a note that this record partly supersedes them.

## Alternatives

- The self-label `!no-unauthenticated` on our profile record. Rejected: Bluesky reads it only from its own record; on
  ours nobody but us would read it, and there is no standard value for "only the member".
- A setting in our database (`app.discoverability`). Rejected: it would not travel with the member's record, and another
  app reading `sh.unset.profile` could not honour it.
- Showing the 404 of a missing account to anyone left out (D7 as written). Rejected by Alex, 19:46Z.
- Calling a level "Private". Rejected: the records stay public on the network.
- Two forms, the choice saved alone through `POST /profile` and Search and AI shown once a saved choice is public.
  Built first; Alex asked for Search and AI folded under Public instead (20:26Z). One save now writes the PDS, then our
  database; if the second write fails after the first, the member sees the error and saving again finishes it.
- A long explanation behind each question mark. Drafted; Alex chose the one line for now (20:26Z).

## Consequences

The public page is no longer the same bytes for everyone: a signed-in viewer's copy is private and never stored, and a
visitor's still caches a minute. Other
apps that read `sh.unset.profile` do not know this field until they choose to. A page that leaves Public can stay in a
search engine for days to weeks. Privacy notice: a sentence on what the choice does and does not do is Alex's wording
(draft in the PR).

## Compliance

`domains/profile/visibility.test.ts` covers the reading, the strict save and the viewer table;
`shared/lexicons/src/limits.test.ts` holds a record at the byte limit and one past it;
`tests/integration/web/public/public-profile.test.ts` covers each level for a visitor, another member and the owner,
and an unknown value; `tests/integration/postgres/public-profile-store.test.ts` keeps non-public pages out of the
sitemap and robots.txt; `tests/integration/web/settings/profile-save.test.ts` and `tests/e2e/privacy-settings.spec.ts`
cover the one form with no script. Acceptance is Alex's line on the pull request that adds this record.
