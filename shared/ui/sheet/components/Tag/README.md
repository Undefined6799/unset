# Tag

A status word in square brackets, `[err]`, in `mono` at the surrounding size; nothing around it, no fill, no border.

## Provide

- `status`: `ok` (`success`), `err` (`danger`), `info` (`link`) or `plain` (`ink-muted`, default).
- `children` (optional): the word inside the brackets; defaults to the status name (`[ok]`, `[err]`, `[info]`).

## Use

- Lowercase, one short word: `[ok]`, `[err]`, `[live]`, `[v0.3.1]`.
- ASCII only; the brackets are always there, so the state never relies on colour alone.
- Inline with text or at the start of an output line; never as a button or a filter chip.
