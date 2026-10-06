# Select

A dropdown styled like Input (40px, 1px `line-strong` border, `radius-xs`) with a ▾ caret in `ink-muted`. The open list is drawn by the system, not the browser, so it looks the same everywhere.

## Provide

- `options`: `[{ value, label }]`; `label`, `hint`, `error`; `value` + `onChange(value)`, or `defaultValue`; `name` to post with a form; `placeholder`, `disabled`.

## Use

- For six or more options, or when space is tight; fewer belong in a RadioGroup.
- Open: the field border darkens to `ink-muted`, the caret flips to ▴, and the list (level 3) drops 4px below on `ground` with a thin 1px `line-strong` border and the very light `shadow-menu`, stacked at `z-menu`. Options are `mono` 14px; the hovered or keyboard-active one fills `line`; the chosen one is marked → in `success`.
- Keyboard: ↓ / ↑ / Enter / Space open it and move, Home / End jump, Enter picks, Esc closes; clicking outside closes it.
- Typing letters jumps to the first matching option: it selects straight away when closed and highlights it when open. Typing the same letter again cycles through matches.
- The list opens upward when there isn't room below, and scrolls to keep the highlighted option in view.
