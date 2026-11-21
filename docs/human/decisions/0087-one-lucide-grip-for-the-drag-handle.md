---
status: Proposed
date: "2026-11-21"
step: P1.21v
amends:
  - adr: "0055"
    part: point 4, icons stay Iconoir, for the editor's drag handle only
  - adr: "0001"
    part: decision 33, Iconoir 7.12.1 as the one icon set, for one named icon
---
# 0087 — One Lucide icon draws the editor's drag handle

Amends point 4 of [0055](0055-shadcn-svelte-and-one-theme-file.md) ("Icons stay Iconoir") and decision 33 in
[0001](0001-phase-0-defaults.md) for one icon only. Every other icon stays Iconoir 7.12.1, drawn by our `Icon` from the
copied, pinned data. Alex asked on 2026-11-21 at 14:11Z, after the three Iconoir candidates and the Lucide six-dot
grip were shown to him: "Perfect yes get the lucide".

## Context

The Text editor's side handle (P1.21v slice 3) needs a grip a member reads as "drag this". Alex wants the editor to
work and look like the Milkdown playground, Crepe 7.23.0, whose handle is a six-dot grip. Iconoir 7.12.1 has no
six-dot grip: its nearest are `drag` (four arrows), `dots-grid-3x3` (nine dots) and `menu` (three lines, the
placeholder in use since slice 3). Lucide's `grip-vertical` is the six-dot grip, and shadcn-svelte, which ADR 0055
adopted, ships with Lucide as its icon set.

## Decision

1. **Exactly one Lucide icon:** `grip-vertical` from Lucide 1.72.0 (published 2026-11-11, so past ADR 0057's seven
   days), under our name `grip`, used by the editor's drag handle and nothing else.
2. **Copied, not installed:** the file is copied byte for byte from
   `https://raw.githubusercontent.com/lucide-icons/lucide/1.72.0/icons/grip-vertical.svg` to
   `shared/ui/icons/lucide/grip.svg.txt`, with Lucide's ISC licence beside it (`shared/ui/icons/LICENSE-lucide.txt`,
   "Copyright (c) 2026 Lucide Icons and Contributors"; `grip-vertical` is not one of the Feather-derived icons it
   lists). No Lucide package is installed; the ui-inventory guard still refuses any `lucide` or `@lucide/` import.
3. **Pinned and parsed like Iconoir's files:** the icon build (`shared/ui-build/icons.ts`, `LUCIDE`) pins the version
   and the file's sha256, refuses any other file in `icons/lucide/`, and admits only Lucide's root element and its
   radius-1 circles. Each circle becomes the two arcs that draw it as a `<path>`, so the `Icon` component still
   renders only paths. The guard checks the file's hash and content as it does for `icons/svg/`.
4. **Iconoir's line:** Lucide draws at stroke width 2; ours leaves that out so the `Icon`'s 1.5 applies, and keeps
   Lucide's colour, round caps and joins.
5. **Any further non-Iconoir icon needs its own ADR.** This is no second icon set.

## Alternatives

- **Iconoir `dots-grid-3x3`** through the approved-extension record: no ADR, but nine dots in a square, not the
  playground's six in two columns. Offered to Alex on 2026-11-21; he chose Lucide.
- **Keep `menu`** (three lines): reads as a menu button, not a drag grip.
- **Install `@lucide/svelte`**: the whole set and a runtime package for one drawing, and the drift decision 33 rules
  out.
- **Draw our own six dots:** a one-off SVG, which CLAUDE.md forbids, with no upstream to check it against.

## Consequences

- The handle matches Crepe's at Iconoir's line weight. At stroke 1.5 each dot is a ring with a 0.25 unit hole, which
  at 20 pixels is under a fifth of a pixel and reads as a solid dot.
- `icons.json` gains a `lucide` field (version and pin) and a `grip` drawing; the Iconoir `icons` and `iconoir` maps,
  their 59 names and the approved-extension record are unchanged.
- A Lucide release does not reach us until someone copies a new file and bumps the pin in a reviewed PR.

## Compliance

`shared/ui-build/icons.test.ts` (`icon_lucide_*`) checks the pin, the drawing and that a changed, extra or foreign
file is refused; `scripts/guards/ui-inventory.test.ts` (`lucide_grip_is_pinned_named_and_safe`) checks the guard;
`tests/e2e/text-menus.spec.ts` checks the handle draws six dots.
