# Profile lexicon

`sh.unset.profile` is who an account is on unset.sh: the name, picture and details shown at the top of its pages.

## Overview

Each account has at most one profile, stored under the record key `self`. Its presence means the account uses
unset.sh. Deleting it removes the account's pages from readers.

Every field is optional. A profile with no fields is valid and shows the account's handle.

The profile holds no cards. What a page shows, and who may see it, is in [`sh.unset.page`](page.md).

## Schema

<!-- schema:sh.unset.profile#main -->
Record key: `literal:self`

| Property | Type | Required | Limits | Description |
| --- | --- | --- | --- | --- |
| `displayName` | string | No | 64 graphemes; 640 bytes | Name shown at the top of the page. Absent means readers show the handle. |
| `headline` | string | No | 200 graphemes; 2,000 bytes | One line shown under the name. |
| `avatar` | blob | No | `image/*`; up to 2,000,000 bytes | Profile picture. Readers crop it to a square. |
| `avatarShape` | string | No | 32 bytes; known values: `round`, `rounded-square` | How readers crop the avatar. Absent or unknown means round. |
| `location` | string | No | 100 graphemes; 1,000 bytes | A place, as free text the member writes. Not a precise location. |
| `website` | string (uri) | No | 2,000 bytes | The member's website. An http or https URL; readers ignore any other scheme. |
| `listed` | boolean | No |  | True asks directories to list the account. Absent or false means not listed; its pages are still reachable at their addresses. |
| `createdAt` | string (datetime) | No |  | When the profile was first created. |
<!-- /schema -->

## Examples

The smallest profile:

<!-- example:examples/sh/unset/profile/minimal.json -->
```json
{
  "$type": "sh.unset.profile",
  "createdAt": "2026-11-21T15:04:05.000Z"
}
```
<!-- /example -->

A complete profile:

<!-- example:examples/sh/unset/profile/full.json -->
```json
{
  "$type": "sh.unset.profile",
  "displayName": "Sam Rivera",
  "headline": "Product designer. Maps, type and small tools.",
  "avatar": {
    "$type": "blob",
    "ref": {
      "$link": "bafkreibqgoyh5cc2beaorwif4zpknewf7hxrtcorp66hrsaw6iceciiwfm"
    },
    "mimeType": "image/jpeg",
    "size": 184223
  },
  "avatarShape": "rounded-square",
  "location": "Lisbon",
  "website": "https://example.com",
  "listed": true,
  "createdAt": "2026-11-21T15:04:05.000Z"
}
```
<!-- /example -->

## View the lexicon

[`lexicons/sh/unset/profile.json`](../../lexicons/sh/unset/profile.json)

## Writing a profile

- Write the profile with record key `self`. There is only ever one.
- Keep fields you do not know when you save, so you do not erase what a newer app wrote.
- Set `listed` only when the person asks to appear in directories.

## Reading a profile

- Show the handle when `displayName` is absent.
- Crop the avatar to a square, then to the shape in `avatarShape`. Absent or unknown means round.
- Use `website` only if it is an `http` or `https` URL.
- Show the profile's details only to people the main page's `visibility` allows. See
  [Reading a page](../reading-a-page.md).
- An older profile may carry `cards` or `visibility` fields from an earlier draft. Ignore them.

## Related

- [Page lexicon](page.md): what the account shows, and to whom.
- [Permissions](../permissions.md): what an app needs to write a profile.
