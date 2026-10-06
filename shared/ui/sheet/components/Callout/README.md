# Callout

A notice on `surface-raised`, led by one character in a 24px dashed box, both in the tone's colour, with a bold title and a muted line of text.

## Provide

- `tone`: `info` (`i`, `link` colour), `danger` (`!`, `danger`), `success` (`+`, `success`) or `note` (`*`, `ink-muted`).
- `title` and `children` (the explanation).
- `glyph` (optional): any single Unicode character JetBrains Mono draws (arrows, geometric shapes, dingbats such as → ◆ ▲ ✕ ⚡). Never an emoji; follow ⚠-style symbols with U+FE0E so they stay text.

## Use

- The glyph is JetBrains Mono 13px bold, centred in a 24px square with a 1.5px dashed border in the same colour; the box sits `space-3` (12px) left of the text, top-aligned with the title.
- Colour goes on the glyph and its box only; the block stays `surface-raised` with `shadow-1`, `radius-xs` corners and no border.
- The dashed box is for callouts only; Tags stay bracketed text.
- One sentence of text; say what happens and what to do.
- `danger` for anything irreversible; it is announced to screen readers as an alert.
