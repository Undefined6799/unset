# Buttons block

`sh.unset.block.buttons` is a short pitch with up to five buttons.

## Overview

Use it for a call to action: book a call, hire me, subscribe, send an email. The first button is the main one.

A button is one of two kinds, named by its `$type`:

| `$type` | Kind |
| --- | --- |
| `sh.unset.block.buttons#link` | Opens a link. |
| `sh.unset.block.buttons#email` | Opens an email to a published address. |

## Schema

<!-- schema:sh.unset.block.buttons#main -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `heading` | string | No | 120 graphemes; 1,200 bytes | The pitch's heading. |
| `text` | string | No | 400 graphemes; 4,000 bytes | A few lines under the heading. |
| `buttons` | array of open union of `#email`, `#link` | Yes | up to 5 items | In display order. Readers skip kinds they do not know. |
<!-- /schema -->

### Link button

<!-- schema:sh.unset.block.buttons#link -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `uri` | string (uri) | Yes | 2,000 bytes | An http or https URL. Readers ignore any other scheme. |
| `preset` | string | No | 32 bytes; known values: `book-call`, `hire`, `subscribe` | What the button is for; readers word it in the viewer's language. Absent or unknown means readers show the label. |
| `label` | string | No | 40 graphemes; 400 bytes | Button text, used when the preset is absent or unknown. Without a label, readers show the link's site name. |
<!-- /schema -->

A `preset` says what the button is for, so each reader can word it in the viewer's own language:

| Preset | Meaning |
| --- | --- |
| `book-call` | Book a call with this person. |
| `hire` | Hire this person. |
| `subscribe` | Subscribe to what this person publishes. |

### Email button

<!-- schema:sh.unset.block.buttons#email -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `address` | string | Yes | 254 bytes | An email address. Readers check that it is a single plain address before building a mailto link from it. |
<!-- /schema -->

## Example

<!-- example:examples/sh/unset/card/buttons.json -->
```json
{
  "$type": "sh.unset.card",
  "content": {
    "$type": "sh.unset.block.buttons",
    "heading": "Work with me",
    "text": "I take on two projects a season. Tell me what you are making.",
    "buttons": [
      { "$type": "sh.unset.block.buttons#link", "uri": "https://example.com/book", "preset": "book-call" },
      { "$type": "sh.unset.block.buttons#link", "uri": "https://example.com/rates", "label": "See rates" },
      { "$type": "sh.unset.block.buttons#email", "address": "hello@example.com" }
    ]
  },
  "width": "half",
  "surface": "outlined",
  "createdAt": "2026-11-21T15:08:00.000Z"
}
```
<!-- /example -->

## View the lexicon

[`lexicons/sh/unset/block/buttons.json`](../../lexicons/sh/unset/block/buttons.json)

## Writing buttons

- Put the most important button first.
- Prefer a `preset` to a `label` when one fits, so the button is worded in each viewer's language.
- Set a `label` as well when you use a preset, so a reader that does not know the preset still has text to show.
- An email address in a record is public. Use an address the person is happy to publish.

## Reading buttons

- Skip a button whose kind you do not know.
- Ignore a link button whose address is not `http` or `https`.
- For a link button, show your own wording for a known `preset`. Otherwise show `label`. With neither, show the
  link's site name.
- Before building a `mailto:` link, check that `address` is a single plain address. Reject anything with
  several addresses, headers or a query string.
- Hide the block when no button is left to show.

## Related

- [Links block](block-links.md): for a longer list of links.
- [Card lexicon](card.md)
