# Button

A solid `ink` button with no border: near-square (`radius-xs`, 2px), with its bottom-right corner cut off at 45° by `cut`. White on Onyx in Dark, black on Platinum in Light.

## Provide

- `children`: the label, one to three words, set in `label` (JetBrains Mono 12/16, 500, +0.06em) and uppercased by the component; write it in sentence case in code.
- `href` to render a link that looks like a button; otherwise a `<button type="button">`. `disabled` works on both.

## Use

- One style only: `ink` fill, `on-ink` text. No outline, border, accent-coloured or ghost buttons.
- Corners take `radius-xs` (2px), the cut's two vertices too; never round further or cut any other corner.
- 40px tall: `space-3` above and below, `space-6` either side, `space-2` between label and a trailing 16px Icon (`next`).
- Two buttons side by side sit `space-4` apart.

## States

- Hover: the button lifts 3px up-left and a hard `shadow-hard` copy of its shape appears 6px behind it (down-right), no blur. 120ms ease-out; instant under reduced motion.
- Active: drops back to rest and the shadow disappears, as if pressed flat.
- Focus: a solid 2px `focus` outline, offset 2px.
- Disabled: `line` fill, `ink-muted` text, so the shape stays visible in both themes.
