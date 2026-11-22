# Showcase block

`sh.unset.block.showcase` is a set of titled items, such as projects, writing or talks.

## Overview

Each item has a title and may add a short tag, a description, a link and a picture. Only the title is required,
so an item can be as small as one line.

## Schema

<!-- schema:sh.unset.block.showcase#main -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `title` | string | No | 100 graphemes; 1,000 bytes | Heading shown above the items. |
| `layout` | string | No | 32 bytes; known values: `list`, `carousel`, `grid` | How readers arrange the items. Absent or unknown means carousel. |
| `items` | array of `#item` | Yes | up to 50 items | In display order. |
<!-- /schema -->

### Item

<!-- schema:sh.unset.block.showcase#item -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `title` | string | Yes | 120 graphemes; 1,200 bytes | The item's title. |
| `tag` | string | No | 40 graphemes; 400 bytes | Short label shown above the title, such as a year or a kind. |
| `description` | string | No | 300 graphemes; 3,000 bytes | A few lines about the item. |
| `uri` | string (uri) | No | 2,000 bytes | Where the item leads. An http or https URL; readers ignore any other scheme. |
| `image` | `sh.unset.block.defs#image` | No |  | A picture shown with the item, in its own proportions. |
<!-- /schema -->

The picture uses the shared [`sh.unset.block.defs#image`](block-defs.md) shape.

## Example

<!-- example:examples/sh/unset/card/showcase.json -->
```json
{
  "$type": "sh.unset.card",
  "content": {
    "$type": "sh.unset.block.showcase",
    "title": "Projects",
    "layout": "carousel",
    "items": [
      {
        "title": "Harbour atlas",
        "tag": "2026",
        "description": "A printed atlas of one harbour, drawn tide by tide.",
        "uri": "https://example.com/harbour-atlas",
        "image": {
          "image": {
            "$type": "blob",
            "ref": { "$link": "bafkreidl7tabbyfa7rwmeved3mmwxbjh7rrpkdl2gurvkwmvnvgscaexy4" },
            "mimeType": "image/jpeg",
            "size": 412870
          },
          "alt": "An open atlas showing a harbour chart in blue and sand colours.",
          "aspectRatio": { "width": 4, "height": 3 }
        }
      },
      {
        "title": "Type for small screens",
        "tag": "Talk",
        "description": "Notes from a talk on setting text for watches and car dashboards.",
        "uri": "https://example.com/talks/small-screens"
      },
      { "title": "Wayfinding for a night market" }
    ]
  },
  "createdAt": "2026-11-21T15:07:00.000Z"
}
```
<!-- /example -->

## View the lexicon

[`lexicons/sh/unset/block/showcase.json`](../../lexicons/sh/unset/block/showcase.json)

## Writing a showcase

- Keep `tag` short: a year, or a kind such as "Talk".
- Give every picture alt text and its proportions. Both are required.
- Order `items` the way they should appear.

## Reading a showcase

- Treat an absent or unknown `layout` as `carousel`.
- Use an item's `uri` only if it is an `http` or `https` URL. An item without a usable link is still shown, as
  plain content.
- Show each picture in its own proportions, and follow the picture rules in
  [shared definitions](block-defs.md).
- Hide the block when it has no items.

## Related

- [Images block](block-images.md): for pictures without titles and links.
- [Shared definitions](block-defs.md)
- [Card lexicon](card.md)
