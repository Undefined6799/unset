# Table

Rows of data with uppercase `mono` headers over a `line-strong` rule and `line` hairlines between rows; no fills, no zebra stripes.

## Provide

- `columns`: `[{ key, label, align?: "right", mono?: false, muted?: true }]`. Cells are `mono` unless `mono: false`.
- `rows`: objects keyed by column; a value can be text or a component (Tag, Link). Empty values print —.
- `caption` (optional).

## Use

- Right-align numbers; put status in a Tag (`[live]`, `[down]`).
- Keep to what fits one screen width; it scrolls sideways on phones.
