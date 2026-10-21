# Button

An outline button: a 1px `line-strong` edge around the surface it sits on, an `ink` label, softly rounded (`radius-sm`, 4px) with its bottom-right corner cut off at 45° by `cut`. The same in both themes; only the tokens change.

**Outline style approved by Alex 2026-10-21** (replacing the solid `ink` button: calmer contrast, less bulk).

## Provide

- `children`: the label, one to three words, set in `label` (JetBrains Mono 12/16, 500, +0.06em) and uppercased by the component; write it in sentence case in code.
- `href` to render a link that looks like a button; otherwise a `<button type="button">`. `disabled` works on both.

## Use

- One style only: the outline. No solid, accent-coloured or ghost (edgeless) buttons.
- The inside paints `--surface` (else `ground`) so it matches what is behind it; Card sets `surface-card`, Callout, CodeBlock and NewPosts set `surface-raised`. A new surface that holds buttons sets `--surface` too.
- The three square corners take `radius-sm` (4px, Alex 2026-10-21); the cut takes `cut` (10px) and stays sharp. Never round further or cut any other corner.
- 32px tall: `space-2` above and below, `space-4` either side, `space-2` between label and a trailing 16px Icon (`next`).
- Two buttons side by side sit `space-4` apart.
- Contrast: the label is 17:1 on `ground` in both themes; the edge is 3.8:1 (Dark) and 3.6:1 (Light) against `ground`.

## States

- Hover: the colours stay as they are. The button lifts 2px up-left and a hard `shadow-hard` copy of its shape appears 4px behind it (down-right), no blur. 120ms ease-out; instant under reduced motion.
- Active: drops back to rest and the shadow disappears, as if pressed flat.
- Focus: a solid 2px `focus` outline, offset 2px.
- Disabled: the edge turns `line` and the label `ink-muted`, so the shape stays visible but quiet.
