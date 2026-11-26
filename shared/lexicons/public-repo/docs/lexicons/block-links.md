# Links block

`sh.unset.block.links` is a set of links, such as a person's accounts on other sites.

## Overview

Each link has an address and, optionally, a label and a one-line description. The reader supplies the icon and
the site name from its own list of known sites.

## Schema

<!-- schema:sh.unset.block.links#main -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `title` | string | No | 100 graphemes; 1,000 bytes | Heading shown above the links. |
| `layout` | string | No | 32 bytes; known values: `list`, `carousel`, `grid` | How readers arrange the links. Absent or unknown means list. |
| `items` | array of `#link` | Yes | up to 50 items | In display order. |
<!-- /schema -->

### Link

<!-- schema:sh.unset.block.links#link -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `uri` | string (uri) | Yes | 2,000 bytes | An http or https URL. Readers ignore any other scheme. |
| `label` | string | No | 100 graphemes; 1,000 bytes | Text shown for the link. When present it is shown, even if the URL names an account; when absent, readers show the account or site name. |
| `description` | string | No | 200 graphemes; 2,000 bytes | One line about the link. |
<!-- /schema -->

## Example

<!-- example:examples/sh/unset/card/links.json -->
```json
{
  "$type": "sh.unset.card",
  "content": {
    "$type": "sh.unset.block.links",
    "title": "Elsewhere",
    "layout": "list",
    "items": [
      { "uri": "https://example.com/portfolio", "label": "Portfolio", "description": "Selected work since 2019" },
      { "uri": "https://example.org/sam", "label": "Notes" },
      { "uri": "https://example.net/@sam" }
    ]
  },
  "width": "half",
  "createdAt": "2026-11-21T15:06:00.000Z"
}
```
<!-- /example -->

## View the lexicon

[`lexicons/sh/unset/block/links.json`](../../lexicons/sh/unset/block/links.json)

## Writing links

- Store the full `http` or `https` address.
- Add a `label` only when the person wants specific text. Without one, readers show the account or site name.
- Order `items` the way they should appear.

## Reading links

- Ignore a link whose address is not `http` or `https`.
- Show `label` when it is present, even if the address names an account you recognise.
- Take the icon and site name from your own list of known sites. Never fetch the linked site to find them: that
  would tell the site who is viewing the page, and let it choose what your app shows.
- Treat an absent or unknown `layout` as `list`.
- Hide the block when no link is left to show.

## Related

- [Buttons block](block-buttons.md): for one or two calls to action.
- [Card lexicon](card.md)
