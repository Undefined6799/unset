---
status: Proposed
date: "2026-11-21"
step: P1.31w
amends:
  - adr: "0086"
    part: point 3, the card list moving from the profile to the page record sh.unset.page
  - adr: "0086"
    part: point 6, the permission set sh.unset.authFull also covering sh.unset.page
  - adr: "0086"
    part: point 7, the published profile schema replaced once more, and the page schema added
  - adr: "0078"
    part: point 1, the visibility field moving from sh.unset.profile to the main page sh.unset.page/self
---
# 0091 — A page record holds the card list, and the profile is the account's identity

Alex, 2026-11-21 19:44Z: "maybe like we should have a lexicon that's just like the page, and the profile will be
like that information that we have in the compact avatar with the name and stuff. Like that will be the profile".
At 20:08Z he kept more than one page per account open ("someone wants to have a personal page and a business page,
or something more personal for like his family and something like more open for the public ... initially we're
gonna build only one page"), and at 20:22Z asked whether the same page could serve community pages. At 22:38Z: "i
would just have "self" now and we can add room or community or whatever word later to the lexicon, the visibility of
the page should live with the page". Told that a key of `literal:self` cannot later be widened (below), he chose at
22:45Z to keep the key `any` with only `self` written, read and shown. Nothing is published yet:
`lexicons.lock.json` is still `{}`, so this is the last cheap moment to change the shape.

## Context

ADR 0086 put the ordered card list (`cards`, at most 100 `#cardRef`) on `sh.unset.profile`. The profile then mixed
two things that change for different reasons: who the account is (name, headline, avatar, location, website,
visibility, listed), which every surface that names the account reads, and what one page shows, which only the
page reads. A second page, a page per audience or a community page could not be added without either a second
list on the profile or a breaking change to it. Bluesky keeps the same split: `app.bsky.actor.profile` is identity,
and what an account shows lives in other records (`app.bsky.feed.post`, `app.bsky.graph.list`).

## Decision

1. **`sh.unset.page` holds one page's cards and who sees it**: `cards` (`#cardRef`, at most 100, the rules of ADR
   0086 point 3 with "the page's own repository" in place of "the profile's"), `visibility` (point 5) and
   `createdAt`. Nothing in it names a person: it is a page of an account. A card may be named on more than one page.
2. **Record key `any`; the main page is `self`.** The page under `self` is the account's main page, shown at its
   profile's address (`/@handle`). Our app writes, reads and shows only `self`. Readers, our index and our app show no
   page under any other key until a later ADR says where it goes; the index skips such a page without counting it as
   refused, so a page written by a later release or another client is never treated as broken. `any`
   (atproto.com/specs/record-key) is what lets later pages use readable keys (`work`, `family`) with no schema change.
   `literal:self` could not be widened to `any` later: the lexicon spec's evolution rule says "new data must be valid
   under the old Lexicon" (atproto.com/specs/lexicon, "Lexicon Evolution"), and a client built on `literal:self`
   refuses any other key (`@atproto/lex-schema` 0.2.11 `dist/schema/record.js:79`, parsed by `@atproto/lex-rpc`
   0.0.3 `dist/util.js:174` `rkeyFor`); our guard refuses a key change too (`breaking-check.ts:32`). Its way out is a
   new lexicon name, which a room or community record may still take later.
3. **The profile is identity only**: `displayName`, `headline`, `avatar`, `avatarShape`, `location`, `website`,
   `listed` (the directory, ADR 0062), `createdAt`. Its `cards` and `#cardRef` move to the page, and its `visibility`
   moves to the page (point 5).
4. **Reader rules.** A profile with no main page shows its header and no cards, to everyone (no page is no choice).
   A main page with no profile shows nothing (the index's public view joins the page to a visible account's profile).
   Deleting the main page clears every card's place and its choice; deleting the profile hides the page. A main page
   our index refuses (invalid, or past its size cap) is kept as a page with no cards shown only to its member
   (`REFUSED_PAGE` in `domains/profile/index-plan.ts`), never dropped, since a dropped page would read as public.
5. **Who sees the page lives on the page, and replaces ADR 0078 point 1.** `sh.unset.page.visibility` is what
   `sh.unset.profile.visibility` was: optional, at most 32 bytes, known values `public`, `signed-in`, `owner-only`;
   absent means public and an unknown value means owner-only. ADR 0078's three levels, its table of who sees what,
   its limited page and its listing rules (point 4) are unchanged; only where the choice is stored moves. Settings ›
   Privacy writes it to `sh.unset.page/self`, creating the page with no cards when there is none. The main page's
   choice is the account's: the profile's details shown with the page follow it as before, and so does any surface
   that shows the account outside the page (the directory, the read API and chat lookup, which ADR 0078 point 6 keeps
   on "hidden reads as missing"). The profile carries no visibility of its own, so the two can never disagree; a
   `visibility` left on a profile by the older shape is kept as an unknown field and no longer read.
6. **The permission set `sh.unset.authFull` covers `sh.unset.profile`, `sh.unset.page` and `sh.unset.card`**, still
   nothing else in the account.
7. **Room for later, built not at all now.** Several pages: a later ADR names where a page under another key shows
   (an address, a switcher) and adds it to the index. Each page carries its own `visibility` from the start, so a
   later page needs no new field; a later ADR may instead store a page elsewhere (atproto's permissioned-data
   proposal, "spaces", would let these records be written there unchanged). Community pages: a
   community that is its own account uses its own `self` page unchanged; a community run from a member's account
   would be a page under another key, defined by that later ADR. An atproto repository has one writer, so who may
   edit a community's page (delegated editing through our server, or a page naming cards from several members'
   repositories) is a separate design. Point 1's own-repository rule refuses other repositories' cards today; a
   later ADR may loosen it for such pages, and readers that keep today's rule skip those entries.
8. **The published profile schema is replaced once more**, and `published/sh.unset.page.json` is added. This loosens
   the breaking-change guard for one file: the mechanism is replacing the snapshot the guard compares
   `sh.unset.profile` against; what it loosens is that one comparison in this one PR; the risk is a reader built on
   the 0086 shape; what still holds is that nothing was ever published (the lock is `{}`), so no such reader exists,
   and the guard compares every later change to both files against the new snapshots.

## Consequences

- The index gains `idx.page` (migration 0042, the main page only) and the view `idx.public_page` for web; each card's
  place in `idx.section` comes from the page's list. `core.erase_did` names `idx.page.did` and `idx.page.uri`, and the
  rows go by the cascade from `idx.account`, as the profile's do. The page is the member's own public record, like
  the profile, so it adds no personal data of a new kind.
- The app writes a new card and the page that lists it in one commit (ADR 0086's P1.31u rule, now on the page); the
  first card, or a first Privacy choice, creates the main page. Settings › Profile only touches the profile; Settings ›
  Privacy only the page (one more PDS read on that page).
- Staging switch: staging accounts are disposable. Their cards, their profile's `cards` field and any page are
  cleared, and members sign in again, since the grant now names `sh.unset.page`. Each account's old choice is set
  again on the page before others load it, since the profile's field is no longer read (steps in
  `/mnt/project-files/plans/lexicons/staging-switch-steps.md`).

## Alternatives

- **Keep the list on the profile** (ADR 0086): one record fewer, but a second page would need a second list or a
  breaking change, and identity readers would read every page's list. Rejected.
- **Record key `literal:self` for the page**: simpler today, but more pages would need a new collection. Rejected for
  `any` with `self` as the main page.
- **Record key `tid`**: allows many pages, but the main page would have no fixed address and readers would need a
  pointer from the profile to find it. Rejected.
- **A pointer from the profile to its main page**: an extra field and a second way to disagree; the fixed key `self`
  says the same with nothing to keep in step. Rejected.
- **Keep `visibility` on the profile** (ADR 0078 as written): one choice for the whole account, but a later page could
  not differ from the main one without a second field; Alex, 22:38Z, put it on the page. Rejected.
- **A visibility on both the profile and the page**: two settings that can disagree, and every reader must combine
  them. Rejected.

## Compliance

`shared/lexicons/src/limits.test.ts` proves the page's 100 cards and that the profile no longer holds cards;
`shared/lexicons/scripts/build.test.ts` holds the permission set to profile, page and card;
`domains/profile/page.test.ts` the page's list rules; `domains/profile/index-plan.test.ts` that the index keeps the
main page, ignores other keys and keeps a refused main page closed; `domains/profile/visibility.test.ts` that the
choice is written to the page and no longer to the profile; `tests/integration/postgres/index-store.test.ts` that a
page under another key moves nothing, that deleting the main page clears the cards' places and that a refused main
page reads as owner-only; `tests/integration/postgres/public-profile-store.test.ts` that listings read the page's
choice and ignore one left on the profile; `tests/integration/web/settings/profile-save.test.ts` that Settings ›
Privacy writes only the page. Acceptance is Alex's line on the pull
request that adds this record.
