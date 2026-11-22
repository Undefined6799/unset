---
status: Proposed
date: "2026-11-22"
step: P1.31x
amends:
  - adr: "0086"
    part: point 2, the text block sh.unset.block.text gaining the optional fields tableStyle and textStyle beside its Markdown, defined in the new lexicon sh.unset.markdownStyle
---
# 0110 — A text card keeps its looks beside the Markdown, each named by its block's line fingerprints

Alex asked for table lines a member can choose (2026-11-22, 00:37Z to 00:46Z: four switches for a card's tables,
then single lines shown or hidden, on each side of each box) and for alignment per block (item 20 of
`/mnt/project-files/plans/editor/target-look-decisions.md`). His rule from the same thread holds: the text is exactly
Markdown (CommonMark plus GFM, with math in GitHub's syntax), so no look goes into the text. For the styling lexicon
he then set these rules, in his words:

- "we need to make sure that those lexicon are simple, optional and easily replaceable (the styling ones)"
- "i would like it to be simple as in other app could also use it"
- "i want it to be a simple as possible, while maintaining markdown, im not against the fingerprinting" (01:34Z)
- "it would be nice to manage and keep those tag following what they are targetting even if the md is modified
  somewhere else" (01:35Z)
- "if the sha changes then it just goes back to normal look, i think we should do the first few of the sha of each
  line, if any change outside the editor, it goes back to normal md and it has to be added again via our editor"
  (02:05Z)
- "i thought it would be more something like 3 small string for the table for exemple", "otherwise you still need
  to find what lines make that sha", "and if you have a fingerprint per line, it tell you how many you have"
  (02:12Z)

Nothing is published yet (`published.lock.json` is `{}`), so the shape can still change freely before this merges.
The options, the prior art and three review rounds are in `/mnt/project-files/plans/lexicons/styling/`
(`options-2026-11-22.md`, `review-options-2026-11-22.md`).

## Context

GFM tables (https://github.github.com/gfm/#tables-extension-) have no borders, CommonMark has no alignment for a
block, and raw HTML is refused in our text (ADR 0086 point 2). So a look needs a field beside the text, and it must
say which block it belongs to, although Markdown gives a block no lasting identity. A look stored by position moves
onto other text when the Markdown is edited elsewhere. Formats that never drift store the look on the thing it
styles (Leaflet's `pub.leaflet.pages.linearDocument#block`, `hyperlink-academy/leaflet` 58a404b), but their blocks
are not Markdown.

## Decision

1. **Two optional fields on `sh.unset.block.text`:** `tableStyle` and `textStyle`, beside `text`, which stays one
   Markdown string. Their shapes are `#table` and `#text` in a new lexicon, `sh.unset.markdownStyle`, which names
   nothing of ours, so another app's Markdown record can carry the same two fields. The name is flat because the
   build allows one group only, `sh.unset.block` (ADR 0086 point 2).
2. **Table lines.** `tableStyle` holds four optional booleans for every table in the text, each false when left out
   (the atproto style guide's rule for optional booleans): `hideHeaderLine`, `hideRowLines`, `showColumnLines`,
   `showOutline`. Our look with none set draws the header line and the row lines, and no column lines or outline.
   `tableStyle.tables` lists up to 20 tables that have single cell sides: `{ lines, edges }`, with up to 250
   edges `{ direction, line, cell, hide? }`. An edge shows its side, or hides it with `hide`, whatever the switches
   say. Edges are grid segments, so two neighbouring cells share one stored side. With rows counted from 0 (the
   header is row 0) and columns from 0, the box in row r, column c has: top = horizontal line r, cell c; bottom =
   horizontal line r + 1, cell c; left = vertical line c, cell r; right = vertical line c + 1, cell r.
3. **Alignment.** `textStyle.align` lists up to 200 blocks: `{ lines, value }`, where `value` is `center` or
   `end` (`knownValues`; `end` is the right side in left-to-right text). It applies to paragraphs, headings and
   block quotes.
4. **A look names its block by one short fingerprint for each of the block's lines.** `lines` is a list of 1 to
   1,000 strings, one for each source line of the block, in order. Split the text into lines as CommonMark does
   (LF, CR, or CRLF: https://spec.commonmark.org/0.31.2/#line-ending). For a table, leave out the delimiter row.
   For each line, remove every space (U+0020) and tab (U+0009) and keep the first 8 lowercase hexadecimal
   characters of SHA-256 over the UTF-8 bytes. The number of strings is the number of lines, so no count is
   stored, and a reader fingerprints each line of the text once and then looks for the strings in a row (Alex,
   02:12Z).
5. **Reader rule.** To place looks, read the text as CommonMark with the GFM table extension only: no math and no
   footnote extension, because those change where blocks start and end. This parse only places looks; a reader may
   still draw math its own way. Note the line each top-level block starts on. A look matches a block when the lines
   from that start give exactly the look's fingerprints, in order, and the block ends there: the next line is blank,
   the end of the text, or the start of another top-level block as the parser reports it. Looks with the same
   fingerprints go to the matching blocks in order; if their numbers differ, none applies. A look with no match is
   ignored and its block shows as plain Markdown. A block that can carry a look never holds a blank line, so a
   fingerprint of an empty line matches nothing. A reader that knows nothing of looks shows the whole text as plain
   Markdown.
6. **What follows from the rule.** A look stays with its block when text is added, removed or moved around it, in any
   app. Any change inside the block outside our editor, other than spaces and tabs, puts that block back to the normal
   look, and the member adds the look again in our editor (Alex, 02:05Z). A look cannot land on other words, because
   only a block with the same lines matches. Spaces are ignored because serialisers re-pad tables (`tablePipeAlign`
   defaults to true in mdast-util-gfm-table 2.0.1, `lib/index.js:24`, the version P1.21k pins), re-indent and trim.
7. **Validation.** Values outside the bounds or types make the record invalid, as for any field: our app hides the
   card, the index skips it and the editor refuses it. Writing refuses any field a look does not define. Our save
   path writes fresh fingerprints on every save and drops a look whose block is gone.
8. **Never in a look:** CSS, HTML, free colours or fonts, web addresses, hidden text, anything that changes the
   words, pixel sizes. A fingerprint is not text: it reveals nothing that the public text beside it does not.
9. **Growth and replacement.** Each part is optional and stands alone, so a later look is a new optional field or a
   new value, and a successor to a part is a new optional field beside it
   (https://atproto.com/specs/lexicon, "Lexicon Evolution"). Column widths (asked 00:48Z, left out 00:54Z) and a
   look over a stretch of several blocks are not in this version.

## Consequences

- Size: a line fingerprint is about 11 bytes, an edge about 45. At every bound the two parts could pass the
  index's 1,000,000-byte record cap (`domains/profile/index-plan.ts`); such a record is hidden like any oversize
  record. The lexicon cannot bound sums, so the editor step sets our app's own limits for one card, as it does
  for the text (10,000 of 20,000 bytes): each line in at most one look, at most 500 edges, and at most 32 KB of
  looks, so 50 cards still fit the page's 4 MiB.
- Old cards and readers are unchanged. A text card without the two fields is valid and looks as it did.
- Before any look is shown, the page must read block starts with a compliant parser. Our hand-written
  `apps/web/lib/profile/parse.ts` is not one, so micromark (as Milkdown 7.23.0 pins it) on the page is its own
  step under ADR 0057, with a shared corpus of texts and expected fingerprints. Two start-line cases are
  unverified until that corpus proves them: a paragraph after a link reference definition, and a table whose
  header follows a paragraph line. A disagreement between parsers drops a look; it never moves one.
- The editor keeps looks on its nodes and writes `lines` from the saved text on every save. It must keep
  looks on cards that hold `$$` math, where its node sequence and a plain parse differ; that pairing is settled
  in the editor step.
- The plain Markdown box needs no compare step: a block changed there loses its look, and a notice says how many.
- No new personal data: the looks are part of the member's own public card, like the text.
- This step adds only the schemas, their limits and their tests.

## Alternatives

- **Position only** (this PR's first draft: table number, line, cell). Simplest, but an edit elsewhere moves lines
  onto other boxes. Rejected.
- **Block numbers plus one fingerprint of the whole text** (design version 3). Safe, but any edit in another app
  drops every look on the card, every reader must count blocks exactly as we do, and our own Markdown box needs a
  compare-and-carry step. Rejected for the per-block fingerprint.
- **One fingerprint over all the block's lines, plus a line count.** Ten bytes for each look, but a reader must
  try a number of lines at every block start to find what gives that fingerprint. Alex preferred one string for
  each line (02:12Z), and the reviewer found the strictness equal and the reader simpler. Not taken.
- **A fingerprint of the block's first line only**, or of the fewest lines that are unique. Looks would survive
  edits inside the block, but blocks that start alike need extra rules, and Alex chose the strict rule. Not taken.
- **A quote of the block's opening lines** (after the W3C Web Annotation TextQuoteSelector). Readable, but it
  stores text that is never shown, which point 8 forbids. Rejected.
- **The text as a list of Markdown parts, each with its look.** No fingerprint at all, but every text card changes
  shape for good, styled or not, and joining the parts can change how lists read. Rejected: not optional, not
  replaceable.
- **Looks for the whole card only.** Smallest, but it drops single lines and per-block alignment. Rejected.
- **Markers inside the Markdown** (Pandoc or djot attributes, HTML comments). The text would no longer be exactly
  Markdown. Rejected.
- **A separate style record linked to the card** (Alex asked at 00:58Z). A second record and write for each styled
  card, a dangling link when either is deleted, a new index table. Not taken: he chose a field inside the card at
  01:00Z.

## Compliance

`shared/lexicons/src/limits.test.ts` proves each new limit at its value and one past it. Its test `text_looks`
proves that both fields and every switch are optional, that each look requires its line fingerprints and its
setting, that a line fingerprint is exactly 8 characters, that unknown fields are refused on write, and that later
values are still read. Acceptance is Alex's line on the pull request that adds these fields.
