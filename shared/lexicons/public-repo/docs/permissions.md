# Permissions

An app that writes a profile, its pages and their cards asks for one permission set, `sh.unset.authFull`.

## Overview

AT Protocol OAuth grants an app access to named resources in a person's account. A
[permission set](https://atproto.com/specs/permission#permission-sets) bundles the permissions for one family of
lexicons under a name, with a title and a description the person sees on the consent screen.

## Full access

`sh.unset.authFull` covers everything needed to create and edit a profile, its pages and their cards, and nothing
else in the account.

The person sees:

> **unset.sh profile page**
> Create and edit your unset.sh profile, its pages and their cards. Nothing else in your account.

### Requesting it

Include the set in the OAuth scope:

```text
atproto include:sh.unset.authFull
```

### What it grants

<!-- schema:sh.unset.authFull#main -->
| Name | Grants |
| --- | --- |
| `sh.unset.profile` | Records: create, update, delete |
| `sh.unset.page` | Records: create, update, delete |
| `sh.unset.card` | Records: create, update, delete |
<!-- /schema -->

Blocks are not listed because a block is not a record. It is stored inside a card.

## Uploading pictures

A permission set cannot include blob uploads; an app must request them directly
([Permissions, `blob`](https://atproto.com/specs/permission#blob)). An app that uploads avatars or card pictures
adds a blob permission to its scope:

```text
atproto include:sh.unset.authFull blob:image/*
```

## Reading needs no permission

Profile, page and card records are public, like every record in an AT Protocol repository. Any app can read them
without asking.

## Status

The set is not published yet, so an authorization server cannot resolve `include:sh.unset.authFull` today. Until
it is, the same access can be requested as granular scopes:

```text
atproto repo:sh.unset.profile repo:sh.unset.page repo:sh.unset.card
```

## How the set changes

Once published, the set is edited in place and never renamed, because a new name would make every person consent
again. A server recomputes a session's permissions from the current set when its tokens are refreshed, so an
addition widens existing grants without a new consent screen. For that reason the repository's check refuses
to remove anything from the published set, and passes an addition or a change to the consent text only with the
owner's recorded approval.

## Related

- [Quick start](quick-start.md)
- [`sh.unset.profile`](lexicons/profile.md), [`sh.unset.page`](lexicons/page.md) and [`sh.unset.card`](lexicons/card.md)
