# CodeBlock

Multi-line code on `surface-raised` with a bar showing the file name and a copy control, and light syntax colour from the accents.

## Provide

- `code`: the source text.
- `filename` (optional): shown in the bar, `mono` `ink-muted`; a path like `~/.unset/config.toml`.
- `language` (optional): `"plain"` turns colour off.

## Use

- Colours: comments (`#`, `//`, `;`) `ink-muted`; `[section]` headers `plum`; strings `cyan`; numbers and true/false/null `emerald`; everything else `ink`.
- For one command to paste, use CommandBlock instead.
- Code scrolls sideways; never wrap it.
- Copy works like CommandBlock: COPIED in `success`, or FAILED in `danger` with the code selected for a manual copy.
- Level 1: `surface-raised`, `shadow-1`, `radius-xs`; bar and code padded `space-3` × `space-4`.
