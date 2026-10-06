# MediaFrame

A frame that holds a picture at a fixed shape (1:1, 4:5, 9:16, 16:9 or 3:1), cropping it to fill, with 2px corners, a `line` hairline and an optional muted caption.

Approved by Alex 2026-10-04, all five shapes.

## Provide

- `src` (optional) and `alt` (required: describe the picture, or `""` when it is only decoration).
- `ratio`: `1:1` (default; post grids), `4:5` (portrait photos), `9:16` (video covers), `16:9` (landscape), `3:1` (profile cover, the same shape Bluesky uses).
- `caption` (optional): `body-small` in `ink-muted` under the frame.
- `emptyText` (optional): shown when there is no picture, default `[no image]`.

## Use

- The frame keeps its shape before the picture loads (no layout jump), on `surface-raised`.
- Pictures fill the frame (`object-fit: cover`); the server already made the right size, so the frame never upscales a thumbnail into a large slot.
- `radius-xs` corners like every box, and a 1px `line` hairline inside the edge so pale pictures keep their edge on `ground`.
- Images come from the media origin only, load lazily, and carry width and height from the server.
- No border colour, no shadow, no hover zoom.
