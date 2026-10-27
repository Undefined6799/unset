# Readme

**Status: drawn in Figma and shown to Alex 2026-10-23 (file 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v3 frames); not yet
on the design sheet. Staging preview only until Alex approves it on the sheet.**

A member's README, written with the BlockNote editor and stored as the `sh.unset.profile` lexicon's typed blocks
(P2.20w). Rendered on the server with no script; the profile page is the first use.

## Provide

- `blocks`: the README's blocks as the record stores them.
- `labels`: what a screen reader hears for a ticked and an unticked check item.

## Blocks

- Headings 1-3 render as `h2`-`h4`, because the page's own `h1` is the member's name.
- Paragraphs, quotes, code blocks, and lists. Consecutive list items of one style form one list; an item one indent
  deeper than the one before nests inside it. Check items show the kit's `[×]` or `[ ]` mark in `mono`.
- Text runs: bold, italic, underline, strike and inline code. A link is kept only for an `http:` or `https:` address
  (`safeHref`); anything else stays plain text.
- A columns block uses the README's available width, independently of the viewport or profile sidebar. Two columns
  sit side by side from 640px; three from 840px, with a `space-12` gap. Each group stacks below its threshold.

## Use

- Quotes: `ink-muted` text after a 2px `line-strong` bar. Code blocks: `mono` on `surface-sunken`, `radius-xs`.
- Member links carry `rel="nofollow ugc noopener noreferrer"`.
- Text wraps anywhere, so a long word never widens the page.
