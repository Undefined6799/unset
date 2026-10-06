# Progress

A progress bar drawn as text: `[#############-------] 65%`, both brackets and the remaining `-` in `line-strong`, the done `#` in `success`, `mono` 14px.

## Provide

- `value` (0–`max`), `max` (default 100), `width` in characters (default 20), `label` (optional, `ink-muted`).

## Use

- For work with a known end; use Spinner when the end is unknown.
- Keep one bar width across a page.
