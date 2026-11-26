# Images block

`sh.unset.block.images` is one picture, or a small set shown together.

## Overview

One picture shows alone. More show as a set. Each picture is a blob in the person's own repository with alt
text, proportions and an optional caption.

## Schema

<!-- schema:sh.unset.block.images#main -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `title` | string | No | 100 graphemes; 1,000 bytes | Heading shown above the pictures. |
| `fit` | string | No | 32 bytes; known values: `contain`, `cover` | contain shows each picture whole in its own proportions; cover crops them to fill their space, as CSS object-fit does. Absent or unknown means contain. |
| `images` | array of `sh.unset.block.defs#image` | Yes | up to 20 items | In display order. One picture shows alone; more show as a set. |
<!-- /schema -->

Each entry in `images` uses the shared [`sh.unset.block.defs#image`](block-defs.md) shape.

## Example

<!-- example:examples/sh/unset/card/images.json -->
```json
{
  "$type": "sh.unset.card",
  "content": {
    "$type": "sh.unset.block.images",
    "title": "From the studio",
    "fit": "cover",
    "images": [
      {
        "image": {
          "$type": "blob",
          "ref": { "$link": "bafkreid5bn5prlhkc4xz3h6wctdutuzbvd3gdx6iekgxccv5gottg373hm" },
          "mimeType": "image/webp",
          "size": 268114
        },
        "alt": "A desk by a window with proof sheets pinned to the wall.",
        "aspectRatio": { "width": 3, "height": 2 },
        "caption": "Proofs for the harbour atlas"
      },
      {
        "image": {
          "$type": "blob",
          "ref": { "$link": "bafkreif3q7unm2i627oelc24kj47rcfc24bvy4decvbcsc3ozmu4j4zf5m" },
          "mimeType": "image/jpeg",
          "size": 351002
        },
        "alt": "",
        "aspectRatio": { "width": 1, "height": 1 }
      }
    ]
  },
  "createdAt": "2026-11-21T15:09:00.000Z"
}
```
<!-- /example -->

## View the lexicon

[`lexicons/sh/unset/block/images.json`](../../lexicons/sh/unset/block/images.json)

## Writing images

- Upload each picture with `com.atproto.repo.uploadBlob` to the same repository as the card. This needs a blob
  permission beside the permission set; see [Permissions](../permissions.md).
- Always set `alt`. Use an empty string only for a decorative picture.
- Set `aspectRatio` from the picture's real size, so readers can reserve its space before it loads.

## Reading images

- Treat an absent or unknown `fit` as `contain`: show each picture whole, in its own proportions. `cover` crops
  pictures to fill their space, as CSS `object-fit: cover` does.
- Follow the picture rules in [shared definitions](block-defs.md): never hand a blob to a browser unchecked.
- Hide the block when it has no pictures.

## Related

- [Shared definitions](block-defs.md): the picture shape.
- [Showcase block](block-showcase.md): for pictures with titles and links.
- [Card lexicon](card.md)
