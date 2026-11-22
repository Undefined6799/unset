# Card lexicon

`sh.unset.card` is one card on a page. It holds exactly one block.

## Overview

A card is a slot. It says how wide it is and how its surface is drawn, and its `content` holds the block that
says what is inside: text, links, a showcase, buttons or pictures.

A card is shown only when a [page](page.md) names it in `cards`. Creating a card does not put it on a page, and
removing the page's entry hides it without deleting it. One card may be named on more than one page.

## Schema

<!-- schema:sh.unset.card#main -->
Record key: `tid`

| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `content` | open union of `sh.unset.block.text`, `sh.unset.block.links`, `sh.unset.block.showcase`, `sh.unset.block.buttons`, `sh.unset.block.images` | Yes |  | What the card holds: one of the sh.unset.block types. Other apps may add their own types; readers hide types they do not know. |
| `width` | string | No | 32 bytes; known values: `full`, `half` | Width on wide screens. Absent or unknown means full. |
| `surface` | string | No | 32 bytes; known values: `filled`, `outlined`, `plain` | How the card's outer surface is drawn. Absent or unknown means filled. |
| `createdAt` | string (datetime) | No |  | When the card was first created. |
<!-- /schema -->

## Content

`content` is an open union. The block names its own type in `$type`:

| `$type` | Block |
| --- | --- |
| `sh.unset.block.text` | [Text](block-text.md) |
| `sh.unset.block.links` | [Links](block-links.md) |
| `sh.unset.block.showcase` | [Showcase](block-showcase.md) |
| `sh.unset.block.buttons` | [Buttons](block-buttons.md) |
| `sh.unset.block.images` | [Images](block-images.md) |

Because the union is open, another app may store a type of its own in `content`, under its own namespace. A
reader that does not know the type hides the card and does not treat the record as invalid.

## Example

<!-- example:examples/sh/unset/card/text.json -->
```json
{
  "$type": "sh.unset.card",
  "content": {
    "$type": "sh.unset.block.text",
    "text": "## About\n\nI design maps and the tools around them. Before that I set type for a small press.\n\n- Open to freelance work from March\n- Talks and workshops on request\n\nRead more on [my site](https://example.com/about)."
  },
  "width": "full",
  "surface": "plain",
  "createdAt": "2026-11-21T15:05:00.000Z"
}
```
<!-- /example -->

Each block's page has an example card holding that block.

## View the lexicon

[`lexicons/sh/unset/card.json`](../../lexicons/sh/unset/card.json)

## Writing a card

- Use a TID as the record key, as the lexicon requires.
- One card holds one block. For two kinds of content, write two cards.
- Add the card's address to the page's `cards` in the same write, or the card will not show.
- Leave `width` and `surface` out unless the person chose them. Absent means full width and a filled surface.

## Reading a card

- Hide a card whose block type you do not know.
- Hide a card whose block has nothing to show, such as an empty list.
- Treat an unknown `width` as `full` and an unknown `surface` as `filled`.
- `width` applies to wide screens. On a narrow screen every card takes the full width.
- Apply the page's `visibility` to its cards.

## Related

- [Page lexicon](page.md): the list that decides which cards show.
- [Reading a page](../reading-a-page.md)
