# Avatar

A person's profile picture in a disc, with a one-letter mono fallback on `surface-raised` when there is no picture.

**Approved by Alex 2026-10-03** (disc chosen over square: it echoes the mark's fisheye units).

## Provide

- `src` (optional): the picture, already cropped square by the server (256×256 variant).
- `name`: the display name or handle; its first letter is the fallback.
- `size`: 24, 40 (default), 64 or 128 px.
- `alt` (optional): only when no name is shown next to it; otherwise it stays decorative (`alt=""`), because the name beside it already says who it is.

## Use

- Disc shape (`radius-full`), with a 1px `line` hairline inside the edge so pale pictures don't melt into `ground`.
- 24 in lists and chat lines, 40 in headers and post rows, 64 in cards, 128 on the profile page.
- Fallback letter: uppercase, `mono` 500, `ink-muted` on `surface-raised`; never a coloured background, never a generated pattern.
- Never a link by itself: wrap the avatar and the name together in one link.
- Images load lazily and come from the media origin, never straight from a PDS.
