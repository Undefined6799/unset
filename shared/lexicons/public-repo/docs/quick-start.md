# Quick start

Write a profile and a main page with one card, then read them back.

## What you need

- An AT Protocol account, and its DID.
- An OAuth session that may write `sh.unset.profile`, `sh.unset.page` and `sh.unset.card` records.
  [Permissions](permissions.md) has the scope to request.

The examples below use the standard repository endpoints of the account's PDS:
`com.atproto.repo.putRecord`, `com.atproto.repo.applyWrites` and `com.atproto.repo.getRecord`.

## 1. Create the profile

A profile is one record with the record key `self`. Every field is optional.

```json
{
  "$type": "sh.unset.profile",
  "displayName": "Sam Rivera",
  "headline": "Product designer. Maps, type and small tools.",
  "createdAt": "2026-11-21T15:04:05.000Z"
}
```

Write it with `com.atproto.repo.putRecord`, collection `sh.unset.profile`, record key `self`.

## 2. Create a card and put it on the main page

A card holds one block in `content`. The block names its own type in `$type`.

```json
{
  "$type": "sh.unset.card",
  "content": {
    "$type": "sh.unset.block.text",
    "text": "## About\n\nI design maps and the tools around them."
  },
  "createdAt": "2026-11-21T15:05:00.000Z"
}
```

A card shows only when a page names it. The main page is the `sh.unset.page` record with the record key `self`.
List the card's address in its `cards`, written with the account's DID, never its handle:

```json
{
  "$type": "sh.unset.page",
  "cards": [{ "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/sh.unset.card/3lzh2a2c3d4e2" }],
  "createdAt": "2026-11-21T15:05:00.000Z"
}
```

Write the card and the page together in one `com.atproto.repo.applyWrites` call: a `create` for the card in
collection `sh.unset.card`, and a `create` (or `update`, if the page exists) for the page in collection
`sh.unset.page`, record key `self`. Choose the card's record key yourself (a new TID) so you know its address
before the write. Then a reader never sees a page that names a card that does not exist yet.

The order of `cards` is the order on the page. To move a card, reorder the list. To hide one, remove its entry.

## 3. Add a picture

A picture is a blob in the same repository. Upload it with `com.atproto.repo.uploadBlob`, which needs a blob
permission beside the permission set (see [Permissions](permissions.md)), then place the returned blob in the
record:

```json
{
  "image": { "$type": "blob", "ref": { "$link": "bafkrei..." }, "mimeType": "image/jpeg", "size": 268114 },
  "alt": "A desk by a window with proof sheets pinned to the wall.",
  "aspectRatio": { "width": 3, "height": 2 }
}
```

`alt` is required. An empty string means the picture is decorative.

## 4. Read the page

1. Fetch the profile: `com.atproto.repo.getRecord` with the account's DID, collection `sh.unset.profile`, record
   key `self`. No profile means nothing is shown.
2. Fetch the main page: collection `sh.unset.page`, record key `self`. No page means the profile's header is shown
   with no cards.
3. Walk the page's `cards` in order and fetch each card.
4. Show each card's block, or hide the card if you do not know the block's type.

[Reading a page](reading-a-page.md) has the full rules, including which entries to skip and who may see the page.

## More examples

The repository's `examples/` folder holds a complete sample record for the profile, the page and a card of every
block type. Each one is checked against the schemas on every change.
