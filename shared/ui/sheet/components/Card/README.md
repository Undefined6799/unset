# Card

Level 2: a block for grouping a title, a sentence and one link, on `surface-card` (one step lighter than `surface-raised`, fully solid) with the soft `shadow-2`, `radius-xs` corners and no border.

## Provide

- `title`: the card's heading, `heading-3` weight (Space Grotesk 20/26, 600).
- `children`: one or two sentences, `ink-muted`.
- `eyebrow` (optional): a small mono line above the title, an index (`01`), a path or a date.
- `action` (optional): `{ label, href }`, rendered as a standalone Link at the bottom, ending in the `next` Icon.

## Use

- Padding 20px; `space-4` between eyebrow and title and above the action.
- Cards sit on `ground` or over ASCII art; never nest a card in a card, and never put a card on `surface-raised`.
- No border and no accent colour; the lighter surface and `shadow-2` do the lifting.
- Lay cards out in a grid with `space-6` gaps.

## Why cards are solid (approved by Alex, 2026-10-04)

Cards used to be 95% opaque so the ASCII field ghosted through. In Dark, a bright `emerald` glyph under that card pulled `cyan` links and `plum` errors below the 4.5:1 that text needs, so every card is now fully solid.

Contrast, worst case (text over the card with the brightest field colour under it), WCAG 2.x ratio, 4.5 needed:

| Text | Dark, old 95% | Dark, solid | Light, old 95% | Light, solid |
| --- | --- | --- | --- | --- |
| `ink` | 14.44 | 15.62 | 17.48 | 19.06 |
| `ink-muted` | 6.34 | 6.86 | 6.27 | 6.83 |
| `link` (`cyan`) | **4.21 fails** | 4.56 | 5.07 | 5.53 |
| `danger` (`plum`) | **4.19 fails** | 4.53 | 6.55 | 7.14 |
| `success` (`emerald`) | 9.27 | 10.03 | 5.09 | 5.56 |

A solid card reads the same over the field as over plain `ground`. Its Dark accents pass with little to spare (4.56, 4.53), so don't darken `surface-card` or lighten the accents without re-checking.
