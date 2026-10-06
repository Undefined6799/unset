# Header

The site header: the mark on the left linking home, uppercase nav links and one Button on the right, over a 1px `line` rule.

## Provide

- `nav`: `[{ label, href, current? }]`; mark the current page.
- `action` (optional): `{ label, href | onClick }` for the one Button.
- `homeHref` (optional): where the mark links; default `/`.

## Use

- Nav items are `label` style: `ink-muted`, `ink` on hover, and `ink` with a 2px `ink` underline when current.
- At most five nav items and one Button.
- `space-4` top and bottom, `space-6` either side and between items.
- When the header's content is 440px or narrower (phones), the nav and Button fold into a MENU ▾ toggle. It opens a level-3 menu below the header (ground, thin `line-strong` border, `shadow-menu`), with the items stacked and the Button last. Esc, a click outside, or picking an item closes it.
