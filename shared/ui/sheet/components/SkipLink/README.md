# SkipLink

The first thing on every page: a "skip to content" link that stays out of sight until a keyboard user presses Tab, then appears at the top left on `ground` with a 1px `ink` border.

**Approved by Alex 2026-10-03.**

## Provide

- `href` (optional): the target, default `#main` (the shell's `<main id="main">`).
- `children` (optional): the text, default "Skip to content" (from the catalog), uppercased by the `label` style.

## Use

- The first focusable element in the body, before the Header.
- Shown on focus at `space-3` from the top-left corner, above the Header (`z-toast`), with the 2px `focus` outline; hidden again when focus moves on.
- Moved off-screen, not hidden with `display: none`, so it stays in the tab order and in the accessibility tree.
- Not a Button: no fill, no cut, no hover lift.
