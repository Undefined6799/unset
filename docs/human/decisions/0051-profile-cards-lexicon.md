# 0051 — The profile is a minimal record plus one card record per card

Status: Accepted by Alex, 2026-11-17 05:17:25Z, against 90acb64 (his line "Accept ADR 0051 at 90acb64", typed in
the profile cards thread after the coordinator's review of that head, with "Allow a one-time replacement of the
published sh.unset.profile snapshot at 90acb64"). The only changes since that head are this status paragraph, the
index row's status and the ADR 0001 acceptance line. It supersedes these parts of ADR 0037, and nothing else in it:
- Decision 4 (the README as typed blocks edited with BlockNote) and decision 5 (BlockNote loading on the owner's page).
- The README half of decision 7 (`POST /profile/readme`) and decision 8 (keeping a README stored as markdown).

## Context
On 2026-11-17 Alex chose card modules over a freeform README editor for the profile page ("better to have module
rather than freeform markdown"), then reviewed a clickable mockup card by card. He asked for the lexicon behind it
for the whole profile, kept "minimal with few optional ones" so we are not "stuck with too detailed one". Since
nothing is published to the network yet (`published.lock.json` is empty) and only two staging accounts hold
records, he chose a clean start: "yes we can start clean and delete old lexicon, we are in developing phase now".
The design, with each choice and his answers, is in the Claude Doc "Profile lexicon design (ADR 0051 draft)".

The atproto rules decide the shape (https://atproto.com/specs/lexicon, "Lexicon Evolution", read 2026-11-17): once
published, new fields must be optional, nothing may be removed or renamed, limits may not change, and an open union
may gain members. So a field we are unsure of is left out now and added later at no cost.

## Decision
1. **`sh.unset.profile` holds the side column only**: `displayName` and `createdAt` (required), `headline`, `avatar`,
   `avatarShape` (`round` or `roundedSquare`; absent or unknown means round), `location`, `website`, `listed`, and
   `cards`. Everything else is removed: bio, readme, links, cta, email, stats, availability, coverImage and
   updatedAt. `published/sh.unset.profile.json` is replaced with this schema once, with Alex's approval in this PR.
2. **`cards` is the page order**: record keys of the account's `sh.unset.section` records. A key with no record is
   skipped; a record not listed shows after the listed ones, oldest first. A reorder rewrites only this list. Bluesky
   orders profile links the same way (`app.bsky.actor.profile#links`, `@atproto/api` 0.32.1); ours holds plain record
   keys, not pinned versions, so editing a card never rewrites the profile.
3. **`sh.unset.section` is one card**: `content` (an open union), optional `width` (`full` or `half`), `createdAt`.
   The name stays, so the permission set `sh.unset.authApp` does not change and no member re-consents (Alex: "agreed
   with keeping section"). The first card kinds are `#readme` (markdown text, CommonMark, never raw HTML), `#links`,
   `#collection` (titled entries such as projects or writing) and `#buttons` (`#emailButton`, `#linkButton`). Names
   describe a card's shape, not its use; the editor's labels are free to change.
4. **Store only what the member typed.** A link stores its URL, an optional label and description; its icon, site
   name and account name are derived from the URL when the page renders, so a record can never show one account while
   linking to another. Button text comes from the preset; the README.md bar is presentation.
5. **Lexicon limits are generous; the app's are stricter.** Schema limits are permanent; app limits (in the owning
   domain, never above the schema's) can change. For example the headline allows 200 graphemes and the editor 120.
6. **Readers stay lenient, writers strict.** Every card is read through the validator field by field; a card kind a
   reader does not know is hidden, never deleted. Saves are refused if the result would not validate, and fields we
   do not know are kept (ADR 0038).
7. **Later additions are new union members or optional fields**: video (click-to-play, after a CSP line from Alex),
   pictures on collection entries and image cards (after the media proxy), pinned posts.

## Consequences
- The two staging accounts' existing profile and section records are deleted and recreated once this is on staging
  (Alex's choice); no conversion code.
- `domains/profile` no longer handles links; Settings › Profile ignores a sent `links` field. Cards get their own
  module, routes and editor in later steps.
- Nothing new is stored on our side: profile and cards live in the member's PDS, so erasure and export stay the PDS's
  account deletion and repository export.

## Compliance
`shared/lexicons/src/limits.test.ts` holds one record at each limit and one past it for both schemas, and proves the
card union is open (`an_unknown_card_kind_is_valid_since_the_union_is_open`) and the retired profile fields gone
(`retired_profile_fields_are_gone_from_the_schema`). `shared/lexicons/scripts/breaking-check.ts` compares
`schemas/` with `published/` on every pull request, so after this one any removal, rename or limit change fails CI.
`domains/profile/profile.test.ts` keeps app limits at or under the lexicon's. Acceptance is Alex's line on the pull
request that adds this record; ADR 0001 notes the proposal at its end.

## Alternatives
- **Keep the published profile and deprecate fields.** Safe, but seven dead fields forever. Rejected while nothing is
  published.
- **Typed README blocks.** Any reader avoids a markdown parser, but the lexicon grows by a dozen definitions we would
  keep forever. Rejected for markdown, the format GitHub READMEs use.
- **A `position` on each card.** A reorder would rewrite many records. Rejected for the list on the profile.
- **Renaming the record to `sh.unset.card`.** Reads better, but changes the permission set, which never drops a name.
