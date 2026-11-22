---
status: Proposed
date: "2026-11-22"
step: P1.31x
amends:
  - adr: "0086"
    part: point 2, the text block sh.unset.block.text gaining the optional field tableStyle beside its Markdown
---
# 0110 — A text card keeps its tables' look beside the Markdown

Alex chose this in the target-look thread on 2026-11-22. At 00:37Z, on a card, he picked a per-card table-lines setting
with four switches. Then he widened it: "meant hiding single border line" (00:39Z), "it should also act as a show line
when line is hidden" (00:42Z), "i need to be able to ad top bottom and side each side of a box" (00:42Z), and "could it
also alllow per box instead of doing the whole row at once" (00:45Z). Asked whether this was the final table design,
and told it can drift and is permanent once published, he answered "yes thats good" (00:46Z). The settled behaviour is
item 16 in `/mnt/project-files/plans/editor/target-look-decisions.md`. His rule from the same thread also holds: the
text is exactly Markdown (CommonMark plus GFM, with math in GitHub's syntax), so nothing about a table's look goes into
the text. Nothing is published yet (`published.lock.json` is `{}`), so the shape can still change freely before this
merges.

## Context

GFM tables (https://github.github.com/gfm/#tables-extension-) have header, body rows and column alignment, but no
borders. Raw HTML is refused in our text (ADR 0086 point 2). So a member's choice of lines cannot live in the
Markdown. It needs a field beside the text that names lines by position, because Markdown gives a table, a row or a
cell no lasting identity.

## Decision

1. `sh.unset.block.text` gains one optional object, `tableStyle`, beside `text`. It holds every table look setting the
   Markdown cannot hold, and only affects the look. A reader
   that ignores it shows the tables with its own lines, and the text means exactly the same.
2. `tableStyle` holds four optional booleans that apply to every table in the card: `header` (the line under the
   header row), `rows` (between body rows), `columns` (between columns) and `outline` (the edge around the table).
   A switch that is left out means the reader's usual look for those lines.
3. `tableStyle.edges` lists single cell sides, at most 500. Each entry is `{ table, direction, line, cell, shown }`,
   with all five required:
   - `table`: 0 to 99, counted in reading order.
   - `direction`: `horizontal` or `vertical` (`knownValues`, at most 32 bytes).
   - `line`: 0 to 999, the grid line counted from the top or left edge.
   - `cell`: 0 to 999, the position along that line.
   - `shown`: true or false.

   An entry shows or hides that side whatever the switches say. These are grid segments, so two neighbouring cells
   share one stored side and can never disagree. With rows counted from 0 (the header is row 0) and columns from 0,
   the box in row r, column c has these sides:
   - top: horizontal line r, cell c
   - bottom: horizontal line r + 1, cell c
   - left: vertical line c, cell r
   - right: vertical line c + 1, cell r

   Rows, columns and several boxes chosen together are only ways the editor selects boxes. It stores what they set
   as these sides.
4. Reader rule: start from the switches, then apply the edges in order. When two entries name the same side, the
   later one counts. An entry whose table, direction, line or cell the text does not have is ignored, never an
   error. A reader never refuses a card because of `tableStyle`.
5. Drift, accepted by Alex at 00:46Z. Positions refer to the Markdown as it stands.
   - Our editor renumbers the entries when its own tools insert, delete or move rows or columns.
   - It writes each side at most once, and it drops an entry that matches what the switches already give.
   - After an edit of the plain Markdown, in the Edit pop-up or in another app, it drops entries whose position no
     longer exists. Entries that still exist may then sit on other cells, and the member fixes them in the editor.
   - Another app that edits the Markdown is not bound by this, so its edits can move lines.
6. Growth. Other look settings go into `tableStyle` as new optional fields, without a breaking change
   (https://atproto.com/specs/lexicon, "Lexicon Evolution"). Column widths are the likely first one: Alex asked at
   00:48Z how to resize columns, and at 00:54Z left them out of the first version. They could take the shape
   `widths: [{ table, column, share }]`, where a share is relative and not in pixels, so the same card fits any
   screen. A reader that does not know a later field shows its own widths, which is a correct table. New
   `direction` values are open too, and a reader ignores one it does not know.

## Consequences

- The record grows by about 50 to 60 bytes per edge, so at most about 30 KB at 500 edges. That fits easily inside
  the index's 1,000,000-byte record cap and the page's 4 MiB budget (`domains/profile/index-plan.ts`).
- Old cards and readers are unchanged. A text card without `tableStyle` is valid and looks as it did.
- The editor thread builds the switches, the per-box toggles and the renumbering, and every save of a text card keeps
  `tableStyle` with its text. This step adds only the schema, its limits and their tests.
- No new personal data: it is part of the member's own public card, like the text.

## Alternatives

- **Only the four switches** (Alex's first choice at 00:37Z). This is small and never drifts, but it cannot change
  one line or one box, which he then asked for. Rejected.
- **Whole lines only** (`{ table, direction, line, shown }`). This is simpler, but it cannot set one side of one box.
  Adding `cell` later would make old readers apply the entry to the whole line. Rejected for segments now.
- **Each cell stores its own four sides.** Neighbouring cells would hold two copies of one line that can disagree,
  and every reader would need a rule to choose between them. Rejected.
- **Markers inside the Markdown** (an HTML comment or attribute syntax). This breaks his rule that the text is exactly
  Markdown, and raw HTML is refused. Rejected.
- **A separate record for a card's look.** That is a second write and a second record that must stay in step with
  the text. Rejected, because the field sits beside the text it describes.

## Compliance

`shared/lexicons/src/limits.test.ts` proves each new limit (500 edges, table 99, direction 32 bytes, line and cell
999). Its test `table_lines` proves that the field and each switch are optional, that an edge requires all five
parts with whole numbers from 0, and that an unknown direction is still read. Acceptance is Alex's line on the pull
request that adds this field.
