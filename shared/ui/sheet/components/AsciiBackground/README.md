# AsciiBackground

The brand's ASCII field: a static wave of the characters ` .:-=+*#%@` in `mono` 12/14px, sparse characters in `line` / `line-strong` and the densest in `plum`, `cyan` and `emerald` bands from top to bottom. Children sit on top.

## Provide

- `children`: the content on top (usually Cards).
- `density` (0–1, default 0.6), `accents` (default true; false keeps it grey), `seed` (a number to vary the pattern), `cols` / `rows` (default 160 × 32), `height`, and `fadeFrom: "left"` to keep the left side clear for a title.

## Use

- One per page at most: behind a hero or a card grid.
- Put text on top only inside a Card (its solid `surface-card` hides the field behind the text); never set body copy straight on the field.
- The field is decorative and hidden from screen readers.
