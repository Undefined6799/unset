# Page lexicon

`sh.unset.page` is one page of an account: the cards it shows, in order, and who it is meant for.

## Overview

The page under the record key `self` is the account's main page, shown at its profile's address, under the
account's [profile](profile.md).

The record key allows other values, so an account can hold more pages later, such as a work page and a personal
page. Readers show none of them today, until there is an agreed place to show them. Write only `self` for now.

Every field is optional. A page with no cards shows the profile's header and nothing else. Deleting the main
page leaves the profile shown to everyone, with no cards.

## Schema

<!-- schema:sh.unset.page#main -->
Record key: `any`

| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `cards` | array of `#cardRef` | No | up to 100 items | The cards shown on the page, in display order. Only the cards named here are shown: a card not named here is not shown on this page, a reference to a missing card is skipped, and a card named more than once is shown once, at its first place. A card may be named on more than one page. |
| `visibility` | string | No | 32 bytes; known values: `public`, `signed-in`, `owner-only` | Who apps should show this page to. Absent means public; an unknown value means owner-only. The main page's choice is the account's: readers apply it to the profile's details shown with the page and wherever they show the account. A request to apps, not access control: the records stay public. |
| `createdAt` | string (datetime) | No |  | When the page was first created. |
<!-- /schema -->

### Card reference

Each entry in `cards` is one place in the page order.

<!-- schema:sh.unset.page#cardRef -->
| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `uri` | string (at-uri) | Yes |  | at:// address of an sh.unset.card record, written with the DID. Readers accept only a card record in this page's own repository, named by that DID, and skip any other entry (a handle-form address, another account, another kind of record). |
<!-- /schema -->

## Examples

The smallest page:

<!-- example:examples/sh/unset/page/minimal.json -->
```json
{
  "$type": "sh.unset.page",
  "createdAt": "2026-11-21T15:04:05.000Z"
}
```
<!-- /example -->

A main page with five cards:

<!-- example:examples/sh/unset/page/main.json -->
```json
{
  "$type": "sh.unset.page",
  "cards": [
    {
      "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/sh.unset.card/3lzh2a2c3d4e2"
    },
    {
      "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/sh.unset.card/3lzh2a2c3d4f2"
    },
    {
      "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/sh.unset.card/3lzh2a2c3d4g2"
    },
    {
      "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/sh.unset.card/3lzh2a2c3d4h2"
    },
    {
      "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/sh.unset.card/3lzh2a2c3d4i2"
    }
  ],
  "visibility": "public",
  "createdAt": "2026-11-21T15:04:05.000Z"
}
```
<!-- /example -->

## View the lexicon

[`lexicons/sh/unset/page.json`](../../lexicons/sh/unset/page.json)

## Writing a page

- Write the main page with record key `self`.
- Write each card address with the account's DID, not its handle. A handle can change; a DID does not.
- Change `cards` and the cards themselves in one `com.atproto.repo.applyWrites` call, so a reader never sees a
  list that names a card that does not exist yet.
- To hide a card without deleting it, remove its entry from `cards`.
- One card may be listed on more than one page.
- Tell people what `visibility` does and does not do. It asks apps to limit who sees the page. It does not make
  the records private.

## Reading a page

- Show only the page under `self`. Skip pages under other keys without treating them as broken.
- Follow the card rules and the visibility table in [Reading a page](../reading-a-page.md).
- The main page's `visibility` is the account's choice: apply it to the profile's details too.

## Related

- [Profile lexicon](profile.md): the header shown above the page.
- [Card lexicon](card.md): what each entry in `cards` points to.
- [Reading a page](../reading-a-page.md)
