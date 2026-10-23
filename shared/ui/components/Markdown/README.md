# Markdown

**Status: drawn in Figma and shown to Alex 2026-10-23 (file 4hrOlzQ1d0lA8Acm4KyLVf, page Profile, v3 frames); not yet
on the design sheet. Staging preview only until Alex approves it on the sheet.**

Member-written text in a small markdown subset, rendered as plain elements with no HTML pass-through. Any feature may
use it (Alex, 2026-10-23 03:00Z: "the markdown renderer may be used in other features later as well"); the profile
README is the first.

## Provide

- `source`: the member's text. At most 10,000 characters and 200 blocks are read (`MARKDOWN_LIMITS`).

## Syntax

- `# ` and `## ` headings use `heading-2`, `### ` uses `heading-3`. The page's own `h1` stays the page title.
- Paragraphs keep single line breaks. `- ` or `* ` bullets, `1. ` numbered lists, `> ` quotes, ``` fenced code.
- `**strong**`, `*em*`, `` `code` ``, `[label](url)`. A link is kept only for `https:` or a path on our origin
  (`safeHref`); anything else stays literal text.
- A line `---` starts a new row under a 1px `line` rule. Inside a row, a line `:::` starts a new column (at most
  three). Columns sit side by side with a `space-12` gap from 720px and stack below it.

## Use

- Quotes: `ink-muted` text after a 2px `line-strong` bar. Code blocks: `mono` on `surface-sunken`, `radius-xs`.
- Member links carry `rel="nofollow ugc"`, plus `noopener noreferrer` when they leave our origin.
- Text wraps anywhere, so a long word never widens the page.
