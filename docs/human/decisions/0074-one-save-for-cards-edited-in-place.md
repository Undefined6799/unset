# 0074 — Text cards edited in place, saved together by one Save

Status: Proposed (awaiting Alex). Step P1.21v. Alex, 2026-11-20 19:03Z and 19:05Z, after trying #1827 on staging:
"when I'm on my profile, I should be allowed to edit it the way I want to. The only thing that should appear when I
want to edit like the box is the full width, half width, if it's filled, outline, or plain"; the unsaved-changes bar
"above my display name and my avatar" stays "glued to the nav bar". Earlier the same day (03:34Z) he asked for one
Save at the top for every changed card and unsaved text kept on the device, with no leave warning.

## Context

Today each card has its own form and its own save (ADR 0051): a dialog opens, the member edits one card, and
`?/save` writes that record with `putRecord` and `swapRecord`. Editing on the page means several cards can change
before the member presses Save, and one Save that wrote them one by one could leave half of them written when a
write fails. The PDS has one call that writes several records atomically, `com.atproto.repo.applyWrites`, and it is
how Bluesky's own app writes several records at once.

## Decision

1. **One Save, all or nothing.** A new form action, `?/saveAll`, takes every changed card as `cards.N.<field>`, with
   each card's `key` and `version` (the record CID the member's editor opened). Every card is read and checked by the
   same parser as one card's form (`readCardForm`, `parseCardInput`) before anything is read from the PDS; a card
   named twice, a missing version or a stray field is `card.invalid`. The writes go in one
   `com.atproto.repo.applyWrites` call of `update` writes: all land or none do, whenever the changed cards fit one PDS
   call (up to about 1 MB of changed text, item 6), which is almost every Save. Past that they go in several calls in
   page order, each all or none, each swapping on the commit the one before it returned, so any other write in between
   stops the chain. Every card is checked against its editor's version before the first call. When a later call
   fails, the Save is `card.save_partial` with `saved`, the cards written, and a message that names the cards saved
   and not saved as they read on the page (a Text card's first line, else its title); the rest stay unsaved, with
   their drafts, and Save again writes them. Nothing is written twice or over another tab's text.
2. **Concurrency (DA-4).** applyWrites has no per-record swap, only `swapCommit` on the whole repo. So the action reads
   the repo's head (`com.atproto.sync.getLatestCommit`), then lists the cards, and calls applyWrites with that head.
   Each card must still be the version its editor opened: one that is not is refused as `card.conflict` and named,
   so the member's text is never written over another tab's. When the head moved for any other reason (a like, the
   profile), the PDS answers InvalidSwap with nothing written, and the action reads once more and tries again; a
   second refusal is `card.cards_changed`. One retry, at one layer (RE-1). A card the list does not hold is
   `card.missing`; when the list was cut short by the read budget it cannot be told from gone, so the Save is
   `card.list_incomplete`.
3. **Every refusal names its card** (`card`, the key) and, for a field, the Save's own field name (`cards.1.text`),
   so the page can put the message beside the card the member typed in.
4. **The page, with script.** On the owner's page each Text card is a live editor (P1.21u's Milkdown) once the page is
   idle, with no Edit press and no Write and Preview tabs. Width and Style are radio groups in the card's More menu.
   "Show Markdown" swaps the editor for the plain field. The unsaved-changes bar sits above the name and avatar,
   sticky under the header at `var(--site-header-height)`, and holds Save and Discard. Unsaved text is kept on the
   device only (`localStorage`, keyed by a hash of the DID and the card key, with the version it started from),
   offered back when the page opens, never merged on its own, and cleared by sign-out's `Clear-Site-Data`. These land
   in the later slices of P1.21v; this record covers them so the step has one decision.
5. **No script.** Unchanged and complete: each card keeps its own form and `?/save`, with the plain Markdown field
   and the Width and Style choices.
6. **Limits.** One Save is one request on the `profile` policy (30 a minute per member), however many cards it holds,
   so it costs less than a request per card. The form's cap stays the card form's 2 MiB (Alex, 2026-11-18). One PDS
   call is smaller: @atproto/pds 0.5.51 parses an applyWrites body of at most 1,000,000 bytes
   (`dist/api/com/atproto/repo/applyWrites.js:50`, raised from the server's 150 KiB at `dist/index.js:155`), just
   inside net-guard's 1 MiB for atproto calls. A Text card holds at most 100,000 bytes of text and a page at most 100
   cards, so a call holds nine full Text cards, or every card on a full page at 4 KB each, and a Save at the form's
   cap needs at most three calls. The action measures each applyWrites body as it builds it and splits only when the
   cards do not fit (item 1). A record too large for any call by itself is `card.save_too_large`, named, with nothing
   written; no card the page makes reaches it (a full Text card is at most about 600 KB even if JSON escaped every
   character). @atproto/pds 0.5.51 refuses more than 200 writes in one call, and a page holds at most 100 cards. Our
   PDS runs with its own rate limits off (preflight), so applyWrites costs no write points.

## Consequences

- One new PDS call, applyWrites, under the grant we already hold: the PDS checks `repo:sh.unset.section` with action
  `update` for it, as for putRecord (`dist/api/com/atproto/repo/applyWrites.js:65-89`). No new scope.
- A Save conflicts with any other write to the repo in between; the one re-read keeps that from showing to the member
  unless the repo keeps changing.
- No new personal data reaches the server. Drafts stay on the member's device; the privacy notice gains a sentence
  with the drafts slice.
- Rollback: the page can go back to per-card saves; `?/saveAll` writes the same records `?/save` does.

## Alternatives

- Save each changed card with its own `putRecord`, one after the other: each keeps its own `swapRecord`, but a failure
  part way leaves some cards written and others not, and the member cannot tell which.
- Keep an Edit press per card, as P1.21u has it: no new save path, but it is the separate editing mode Alex asked to
  drop.
- Compare each card only between our two reads, not against the version the editor opened: simpler form, but a
  change made in another tab while the member was typing would be written over.

## Compliance

`interfaces/web/src/routes/[did=did]/card-writes.server.test.ts` (saveAll) checks one write on the head the versions
were read on, a stale version, a gone card, a cut-short list, a refusal by the domain, a card too large for any call,
a Save written only in part, the one re-read and no third try; `save-message.server.test.ts` names the saved and
unsaved cards; `card-form.server.test.ts` splits the Save's form and refuses stray names and too many fields;
`infrastructure/pds/card-records.test.ts` checks the applyWrites body, InvalidSwap, that normal use fits one call
(`normal_use_fits_one_call`), that eleven full cards go in two chained calls, that a write between them stops the
chain and names the saved cards, and that one record past the limit is refused;
`tests/integration/web/app/member-page.test.ts` saves two cards in one commit and eleven full cards in two calls
through the built server (its stand-in PDS refuses a body past the real one's limits) and refuses a stale card, a
named field, a card named twice, a signed-out and a cross-site Save with nothing written; and
`tests/integration/pds-apply-writes.image.test.ts` checks on the pinned PDS that two updates land in one commit, a
stale head writes nothing, an update of a missing record fails the whole call, a body of about 900 KB is taken and one
past 1,000,000 bytes is refused with 413. Acceptance is Alex's line on the pull request that adds this record.

## Sources

@atproto/api 0.30.3 `com.atproto.repo.applyWrites` (`dist/client/types/com/atproto/repo/applyWrites.d.ts`);
@atproto/pds 0.5.51 `dist/api/com/atproto/repo/applyWrites.js` (200-write cap, per-pair grant check, InvalidSwap)
and its `jsonLimit: 1_000_000` (line 50; the server's own is 150 KiB, `dist/index.js:155`);
atproto.com/specs/repository (commits) and atproto.com/specs/data-model (CID string form). Checked on the pinned image
by `tests/integration/pds-apply-writes.image.test.ts`.
