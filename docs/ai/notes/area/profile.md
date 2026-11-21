---
id: profile
type: area
status: current
areas: ["[[profile]]"]
summary: "Hub for domains/profile: what a member writes on their page, checked once, and the records built from it."
code: [domains/profile/index.ts, domains/profile/profile.ts, domains/profile/cards.ts, domains/profile/card-edit.ts, domains/profile/web-address.ts, domains/profile/member-text.ts]
sources: [docs/human/decisions/0037-profile-module-and-page.md, docs/human/decisions/0051-profile-cards-lexicon.md]
importance: normal
related: ["[[identity]]", "[[lexicons]]", "[[http]]", "[[pds]]"]
replaced_by: null
tags: [area, profile]
checked: 2026-11-21
---
# profile

**What it owns.** The member's own page (ADR 0037): the fields they may write, read once from untrusted input into
checked fields (DM-1), and the records built from them. [[identity]] keeps sign-in and handles; this module keeps
the page. Product rules only, no I/O: [[http]] calls it and [[pds]] writes the records.

**Files.**
- `profile.ts`: the four profile fields (`PROFILE_FIELDS`), `parseProfileFields`, `readProfileRecord` and
  `toProfileRecord` for the `sh.unset.profile` record (identity only, ADR 0091). `page.ts`: the main page
  `sh.unset.page/self` and its `cards` list (`withList`, `withCardListed`, `withCardUnlisted`, `withCardOrder`). `APP_LIMITS` sit
  under the lexicon's limits, which are permanent once published (ADR 0051 point 5).
- One page layout (ADR 0077, superseding 0072's choice): apps/web draws `profile-header.svelte` above the cards, the
  avatar opening a native popover About panel (handle, details) with no hover, so it works the same on the
  script-free public page. A stored `layout` field from before is an undefined field the merge keeps.
- `cards.ts`: reading profile cards, one `sh.unset.section` record each (ADR 0051). Lenient: a card that does not
  validate or whose kind is unknown is hidden, and an address that is not plain http(s) is dropped.
  Optional `surface` (ADR 0068) reads as filled when absent or unknown; the editor offers filled, outlined and plain.
- `card-edit.ts`: writing cards. `parseCardInput`, `toCardRecord`, `reorderCards` and `CARD_EDIT_LIMITS` (rows per
  list the editor may write; reads keep the lexicon's limits). A missing surface input preserves the stored choice
  for older editors; explicitly choosing filled clears the stored field.
- `member-text.ts` (P3.12t): `isPlainText` (no control character, no lone surrogate; multi-line keeps "\n" and tabs)
  for every profile and card text field, and `isPlainName` for the display name (also no bidi control or invisible
  character; the joiners U+200C/U+200D stay). Both the save and the lenient profile reader use them.
- A record the index skips (a NUL or lone surrogate Postgres jsonb refuses) shows on the owner's page, read from the
  PDS, but not publicly, read from the index: a profile record skipped makes `/@handle` a 404 (staging break test
  2026-11-21). The text checks above keep such characters out of every save.
- **Save what the index keeps** (P3.12v). Every profile and card record the save writes must pass `fitsIndex`
  (index-plan.ts, the indexer's own check), else it is refused (`profile.too_long`, `card.too_long`).
  `MAX_RECORD_BYTES` equals the pinned PDS's write limit (1,000,000 bytes), so in practice only a record another
  client wrote past that is refused. A record the index skips shows to its owner (read from the PDS) but not publicly.
- **One page budget** (P3.12v). `MAX_PAGE_BYTES` (4 MiB) bounds all of a member's cards together, counted by
  `recordBytes` (JSON in UTF-8): the save (`fitsPage`, `card.page_full`), the indexer (`idx.section.bytes`,
  `ingest_over_budget`), the public read (stops at it in page order) and the owner's list (`CARD_LIST_BYTES`, held
  equal by `record-size.test.ts`) all use it. A single card's edit swaps on that card only, so another tab can still
  pass the budget; the indexer is the hard bound.
- `web-address.ts`: `withScheme` ("alice.dev" means https://alice.dev) and `isWebAddress` (http or https, no
  credentials, and not on the visitor's own machine or network: localhost, .local, private and link-local IPs; P3.12t).

**How data flows.** Form input arrives at [[http]], is parsed here into checked fields or a typed error
(`profile.*`, `card.*`), becomes a record validated against [[lexicons]] (`validateRecord`, `LIMITS`), and
[[http]] writes it to the member's PDS through [[pds]]. Reads go the other way through the lenient readers.

**Who sees the page (ADR 0078).** `visibility.ts` reads `visibility` from the record (absent public, unknown
ownerOnly, fail closed) and `pageShownTo` is the one table of who sees what. The listing SQL in
`infrastructure/postgres/publicProfileStore.ts` must read the field the same way; change both together.

**Links.** [[identity]], [[lexicons]], [[http]], [[pds]]; ADR 0037 and ADR 0051.
