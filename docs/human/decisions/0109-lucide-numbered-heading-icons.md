---
status: Proposed
date: "2026-11-21"
step: P1.21v
amends:
  - adr: "0087"
    part: point 5, a second named set of Lucide icons, the block menu's numbered headings
  - adr: "0055"
    part: point 4, icons stay Iconoir, for the six numbered heading icons only
---
# 0109 — Six Lucide icons draw the block menu's numbered headings

Amends point 4 of [0055](0055-shadcn-svelte-and-one-theme-file.md) ("Icons stay Iconoir") and point 5 of
[0087](0087-one-lucide-grip-for-the-drag-handle.md) ("Any further non-Iconoir icon needs its own ADR") for six named
icons. Every other icon stays Iconoir 7.12.1. Alex asked on 2026-11-21 for "number editing icons from icon wall"
(18:51:14Z, Iconoir), and to "match everything that they have" in the Milkdown playground (18:52:12Z). Iconoir has
no numbered heading icons. Shown the three ways on, he chose "Lucide H1 to H6, with an ADR" at 22:55:56Z.

## Context

The Text editor's block menu (P1.21v) follows Crepe 7.23.0's, which offers Heading 1 to Heading 6, each with its own
numbered icon (`h1Icon` to `h6Icon`, `feature/block-edit/menu/config.ts`). Iconoir 7.12.1 has no `h-1` to `h-6` or
similar; its nearest is `text-size`, one icon for every level, which the menu showed until now. Lucide 1.72.0, the
set ADR 0087 already copies the grip from, has `heading-1` to `heading-6`.

## Decision

1. **Exactly six more Lucide icons:** `heading-1` to `heading-6` from Lucide 1.72.0, under our names `h1` to `h6`,
   used by the block menu's Heading 1 to Heading 6 and nothing else.
2. **Copied and pinned as the grip is:** each file is copied byte for byte from
   `https://raw.githubusercontent.com/lucide-icons/lucide/1.72.0/icons/heading-N.svg` to
   `shared/ui/icons/lucide/hN.svg.txt`. `LUCIDE` in `shared/ui-build/icons.ts` pins each sha256, and the build still
   refuses any other file in `icons/lucide/`. No Lucide package is installed.
3. **The parser grows by exactly what these files hold:** a `<path>` with only a `d` attribute of path data, and a
   circle of radius 1 or 2, drawn as two arcs. Any other element or attribute is refused, as before.
4. **Iconoir's line:** Lucide's stroke width 2 is left out so the `Icon`'s 1.5 applies, as for the grip.
5. **Any further non-Iconoir icon still needs its own ADR.**

## Alternatives

- **Iconoir `text-size` for every level:** no ADR, but six identical icons, unlike the playground. Offered to Alex
  on 2026-11-21; he chose Lucide.
- **Letters H1 to H6 in the icon's place:** no new icon, but text in an icon slot, set in our font, not the
  playground's drawing. Offered too.
- **Draw our own numbered icons:** a one-off SVG, which CLAUDE.md forbids, with no upstream to check against.

## Consequences

- The menu matches Crepe's at Iconoir's line weight. `icons.json`'s `lucide` field lists seven icons.
- A Lucide release reaches us only when someone copies new files and bumps the pins in a reviewed PR.

## Compliance

`shared/ui-build/icons.test.ts` (`icon_lucide_*`) checks the pins, the drawings and that a changed, extra or foreign
file or attribute is refused; `scripts/guards/ui-inventory.test.ts` checks the guard; `tests/e2e/text-menus.spec.ts`
checks each heading item draws its icon.
