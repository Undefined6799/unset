# Text block

`sh.unset.block.text` is formatted text, shown like a README.

## Overview

The text is Markdown. Use it for an introduction, a longer note, or anything that reads as prose.

## Schema

<!-- schema:sh.unset.block.text#main -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `text` | string | Yes | 20,000 bytes | Markdown: CommonMark, which readers may extend with common syntax such as GFM tables, task lists and strikethrough. Syntax a reader does not support is shown as plain text. Readers never render raw HTML and keep only http and https links. Each reader chooses how to show a picture in the text, for example as a link, or loaded through its own proxy so the address never learns who reads it. |
<!-- /schema -->

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

## View the lexicon

[`lexicons/sh/unset/block/text.json`](../../lexicons/sh/unset/block/text.json)

## Writing text

- Write [CommonMark](https://commonmark.org/). Readers may also support common extensions such as GFM tables,
  task lists and strikethrough, but none is guaranteed, so the text should still read well without them.
- Do not rely on raw HTML. Readers never render it.
- Link only to `http` and `https` addresses. Other links are dropped.
- Do not rely on a picture in the text being shown inline. Each reader decides. For pictures that must show, use
  the [images block](block-images.md).

## Reading text

- Never render raw HTML from the text.
- Keep only `http` and `https` links.
- Show syntax you do not support as plain text.
- Decide how to show a picture linked from the text: as a plain link, or loaded through your own proxy so the
  picture's host never learns who is reading. Do not let the browser fetch it directly.
- Hide the block when the text is empty.

## Related

- [Card lexicon](card.md)
- [Reading a page](../reading-a-page.md)
