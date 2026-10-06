# Tabs

Uppercase `label`-style tabs over a 1px `line` rule; the current tab is `ink` with a 2px `ink` underline, the rest `ink-muted`. The chosen tab's content shows below.

## Provide

- `tabs`: `[{ id, label, content }]`.
- `defaultId` (optional), or `value` + `onChange(id)` to control it.

## Use

- For alternatives of the same thing (install methods, languages, platforms); never for page navigation (use Header).
- Two to five tabs, one word each.
- Arrow keys move between tabs; the current tab is the only one in the tab order. Focus is the 2px `focus` outline.
