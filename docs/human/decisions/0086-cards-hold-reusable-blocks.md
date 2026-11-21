---
status: Proposed
date: "2026-11-21"
step: P1.31t
supersedes:
  - adr: "0051"
    part: points 2 and 3, the card list of record keys and the sh.unset.section record with its own card kinds
  - adr: "0025"
    part: Q4, the permission set NSID sh.unset.authApp, now sh.unset.authFull
amends:
  - adr: "0051"
    part: point 1, the avatarShape value rounded-square, and the replaced published profile schema
  - adr: "0070"
    part: point 1, the image def moving from sh.unset.defs to sh.unset.block.defs with any image type up to 5,000,000 bytes
  - adr: "0078"
    part: point 1, the stored visibility values signed-in and owner-only
---
# 0086 — A card holds one reusable block, and the profile lists its cards by address

Alex asked for the lexicons to be right before anything is published, since a published lexicon is permanent. The
review (`/mnt/project-files/reviews/2026-11-21-lexicon-review/`: `report.md`, `independent-review.md`) compared our
draft with Bluesky (`app.bsky.*`, @atproto/api 0.32.3), standard.site and the atproto style guide
(https://atproto.com/guides/lexicon-style-guide). Alex chose the shape on 2026-11-21 ("I like the shape of the
lexicon"), took all five review picks at 17:24Z ("All five picks"), and answered the last five questions at 17:42Z
("2 all yes": the set is named authFull, no `custom` value, follows leave the first set). Nothing is published yet:
`lexicons.lock.json` is still `{}`, and no account serves our schemas.

## Context

ADR 0051 made each card an `sh.unset.section` record whose kinds (`#readme`, `#links`, `#collection`, `#buttons`, and
0070's `#image` and `#gallery`) were defs inside that one file. A card's content could only ever live on a profile, a
new kind meant editing the card's own lexicon, and the names (`section`, `readme`) described our editor, not the data.
The profile listed bare record keys, which name nothing outside its own repository. Several values were camelCase
(`roundedSquare`, `signedIn`, `bookCall`), where the style guide and Bluesky use kebab-case.

## Decision

1. **`sh.unset.card` is one card on a page**: `content` (an open union of blocks, required), optional `width`
   (`full` or `half`, absent means full), optional `surface` (`filled`, `outlined`, `plain`, absent means filled),
   optional `createdAt`. Anything else about how a card looks is a later optional field.
2. **A block is its own lexicon in the one group `sh.unset.block.*`**, so the same block can sit in a card today and
   in another record later: `text` (Markdown, 20,000 bytes: CommonMark, which readers may extend with common syntax
   such as GFM tables, task lists and strikethrough, showing what they do not support as plain text; each reader
   chooses how to show a picture in the text, and this app shows it as a link, loading nothing, until Alex decides
   otherwise), `links` (up to 50), `showcase` (titled entries, up to 50), `buttons` (up to 5: `#email` or `#link`;
   link presets `book-call`, `hire`, `subscribe`, and no preset means the label shows) and `images` (up to 20
   pictures with one `fit`, `contain` or `cover`). `sh.unset.block.defs` holds `#image` (blob `image/*` up to
   5,000,000 bytes, required `alt` and `aspectRatio`, optional `caption`) and `#aspectRatio`. No list has a minimum
   in the lexicon; the editor keeps its own rules. The build refuses any other group (`scripts/build.ts`).
3. **The profile's `cards` lists `{uri}` references** (`#cardRef`, at most 100): the full `at://<DID>/sh.unset.card/<rkey>`
   address. Readers accept only an address of a card in the profile's own repository, written with that DID, and
   compare it as text: they never resolve a handle, and they skip any other entry. Only the cards listed show; a
   missing card is skipped and a repeat shows once, at its first place.
4. **Lexicon ceilings above the app's limits**, as Bluesky does for its gallery: 100 cards and 20 pictures in the
   lexicon, 50 cards (`CARDS_MAX`) and 12 pictures in the app, which can grow without a new schema.
5. **Values are kebab-case**: `avatarShape` `rounded-square`, `visibility` `signed-in` and `owner-only`, preset
   `book-call`. The domain keeps its own names; `domains/profile` maps them in one place each (`BLOCKS`,
   `PRESET_VALUES`, `FIT_VALUES`, `VISIBILITY_VALUES`, the avatar shape values).
6. **The permission set is `sh.unset.authFull`**, covering `sh.unset.profile` and `sh.unset.card` only. Follows
   leave the first set and their lexicon is removed; the feature that writes them adds them back with its own record.
   `shared/config/permanent.ts` pins the new name to this record.
7. **The published profile schema is replaced once more** (`shared/lexicons/published/sh.unset.profile.json`), as
   0051 did. This loosens the breaking-change guard for one file: the mechanism is replacing the snapshot the guard
   compares against, what it loosens is that one comparison in this one PR, the risk is a reader built on the old
   schema, and what still holds is that nothing was ever published (the lock is `{}`), so no reader exists, and the
   guard compares every later change against the new snapshot.

## Consequences

- Staging cards and profiles in the old shape stop showing; staging accounts are disposable, and at the switch their
  card records and their profile's old `cards` field are cleared (a list of plain keys no longer validates, so every
  profile write would be refused until it goes). Staging members sign in again, since the grant now names `sh.unset.card`.
- The app's image pipeline is unchanged here: it still stores and serves its current format and size, inside the
  wider lexicon. WebP at up to 4,096 px and the 2 MB retry belong to the image work (P2.19f).
- Follow-ups, each its own pull request: P1.31u makes the app show only listed cards and writes a new card into the
  list in the same commit (until then the app still shows unlisted cards after the listed ones, which the lexicon
  allows no reader to rely on), and hides a block with nothing to show (an empty list); the index table `idx.section` and the internal kind names `readme`, `collection`
  and `image` are renamed to match; publishing the schemas (DNS and the lexicon account) is Alex's.

## Alternatives

- **Keep `sh.unset.section` with defs inside it** (0051): no migration, but a block could never leave the profile,
  and every new kind edits the card's lexicon. Rejected.
- **Blocks as defs of one `sh.unset.block` file**: one file, but every block change touches all of them and a block
  cannot be versioned alone. Rejected.
- **Show unlisted cards after the listed ones** (0051 point 2): the list would not bound the page, and a card could
  not be kept off the page or placed elsewhere. Alex chose only listed cards.
- **Record keys in the list** (0051): shorter, but they name nothing outside the repository. Rejected for full
  addresses, as Bluesky's `strongRef` and standard.site do.

## Compliance

`shared/lexicons/src/limits.test.ts` proves each limit with a record at it and one past it;
`shared/lexicons/scripts/build.test.ts` holds the one group and the permission set; `validate.test.ts` the unions
across files; `domains/profile/cards.test.ts` the text comparison of addresses (a handle, another account or
another collection places nothing); `shared/config/permanent.test.ts` pins `sh.unset.authFull` to this record.
Acceptance is Alex's line on the pull request that adds this record.

| Q | Question | Value | Answer |
| --- | --- | --- | --- |
| Q4 | Permission set NSID | `sh.unset.authFull` | Answered by Alex 2026-11-21 17:42Z |
