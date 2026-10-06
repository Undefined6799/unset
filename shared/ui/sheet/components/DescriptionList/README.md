# DescriptionList

Pairs of a label and its value, one pair per row: the label in the uppercase `label` style in `ink-muted`, the value in `ink`, with `line` hairlines between rows, like the Table's.

Approved by Alex 2026-10-04.

## Provide

- `items`: `[{ label, value, mono? }]`. `mono: true` for DIDs, handles, hashes and dates a machine printed. A value can be text or a component (Tag, Link). An empty value prints —.

## Use

- For facts about one thing: an account's handle, DID and join date; a post's details; an admin record. For many things with the same fields, use a Table.
- Label column 120 to 160px, value beside it; when the space is 440px or narrower, the label sits above its value.
- Long values wrap anywhere (a DID never pushes the page wider).
- Real `<dl>`, `<dt>` and `<dd>`, so screen readers pair them.
