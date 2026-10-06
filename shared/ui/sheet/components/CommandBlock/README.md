# CommandBlock

A shell command set in `code` on `surface-raised`, led by an `ink-muted` `$` and followed by a copy control; optional output sits in a second block 2px below.

## Provide

- `command`: the exact text to copy. The prompt is never copied.
- `output` (optional): lines of output. `[ok]`, `[err]` and `[info]` at the start of a line become a coloured Tag; lines starting `#` are muted comments.
- `prompt` to change or drop the `$`; `copyable={false}` to hide the copy control.

## Use

- Use for every command a reader might run; never put commands in body text.
- One command per block. Long commands scroll sideways; never wrap them.
- The copy control reads COPY, then COPIED in `success` for 1.4s. If the browser blocks the clipboard it reads FAILED in `danger` and selects the command so the reader can copy it by hand.
- Level 1: `surface-raised`, `shadow-1`, `radius-xs` corners, no border; `space-3` top and bottom, `space-4` either side.
