---
id: profile
type: area
status: current
areas: ["[[profile]]"]
summary: "Hub for domains/profile: what a member writes on their page, checked once, and the records built from it."
code: [domains/profile/index.ts, domains/profile/profile.ts, domains/profile/cards.ts, domains/profile/card-edit.ts, domains/profile/web-address.ts]
sources: [docs/human/decisions/0037-profile-module-and-page.md, docs/human/decisions/0051-profile-cards-lexicon.md]
importance: normal
related: ["[[identity]]", "[[lexicons]]", "[[http]]", "[[pds]]"]
replaced_by: null
tags: [area, profile]
checked: 2026-11-20
---
# profile

**What it owns.** The member's own page (ADR 0037): the fields they may write, read once from untrusted input into
checked fields (DM-1), and the records built from them. [[identity]] keeps sign-in and handles; this module keeps
the page. Product rules only, no I/O: [[http]] calls it and [[pds]] writes the records.

**Files.**
- `profile.ts`: the four profile fields (`PROFILE_FIELDS`), `parseProfileFields`, `readProfileRecord` and
  `toProfileRecord` for the `sh.unset.profile` record, and `withCardOrder` for its `cards` list. `APP_LIMITS` sit
  under the lexicon's limits, which are permanent once published (ADR 0051 point 5).
- `profile.ts` also reads and writes the optional page `layout` (ADR 0072): absent or unknown reads as sidebar;
  a save takes only sidebar or compact, and sidebar clears the field. apps/web draws compact with
  `profile-header.svelte` (a native popover for the details, so it works on the script-free public page).
- `cards.ts`: reading profile cards, one `sh.unset.section` record each (ADR 0051). Lenient: a card that does not
  validate or whose kind is unknown is hidden, and an address that is not plain http(s) is dropped.
  Optional `surface` (ADR 0068) reads as filled when absent or unknown; the editor offers filled, outlined and plain.
- `card-edit.ts`: writing cards. `parseCardInput`, `toCardRecord`, `reorderCards` and `CARD_EDIT_LIMITS` (rows per
  list the editor may write; reads keep the lexicon's limits). A missing surface input preserves the stored choice
  for older editors; explicitly choosing filled clears the stored field.
- `web-address.ts`: `withScheme` ("alice.dev" means https://alice.dev) and `isWebAddress`.

**How data flows.** Form input arrives at [[http]], is parsed here into checked fields or a typed error
(`profile.*`, `card.*`), becomes a record validated against [[lexicons]] (`validateRecord`, `LIMITS`), and
[[http]] writes it to the member's PDS through [[pds]]. Reads go the other way through the lenient readers.

**Links.** [[identity]], [[lexicons]], [[http]], [[pds]]; ADR 0037 and ADR 0051.
