# Tag

A status word in quiet square brackets, `[ ERR ]`: the word in uppercase `mono` in its status colour, the brackets in `ink-muted`, one space inside each bracket. It is a touch smaller than the text around it (0.86em, so 12px in 14px text) with 0.04em tracking; nothing around it, no fill, no border. Approved by Alex 2026-10-21.

## Provide

- `status`: `ok` (`success`), `err` (`danger`), `info` (`link`) or `plain` (`ink-muted`, default).
- `children` (optional): the word inside the brackets; defaults to the status name (`[ OK ]`, `[ ERR ]`, `[ INFO ]`).

## Use

- One short word, written lowercase in code and shown uppercase: `[ OK ]`, `[ ERR ]`, `[ LIVE ]`, `[ END ]`.
- Not for version numbers or other values: write `v0.3.1` as plain `mono` text.
- ASCII only; the brackets and the word are always there, so the state never relies on colour alone.
- Inline with text or at the start of an output line; never as a button or a filter chip.
