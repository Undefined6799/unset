# Footer

The site footer: the mark with "U+25C9" beneath it on the left, link columns on the right, and a small `mono` line at the bottom, over a 1px `line` rule.

## Provide

- `columns`: `[{ title, links: [{ label, href, external? }] }]`; external links get ↗.
- `note` (optional, default "© <year> unset.sh"), `meta` (optional, right-aligned).

## Use

- Two or three columns, at most five links each, labels one or two words.
- Links are `label` style in `ink`; titles in `ink-muted`.
