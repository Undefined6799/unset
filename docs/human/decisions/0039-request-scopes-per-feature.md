# 0039 — Sign-in asks only for the scopes a shipped feature uses

Status: Proposed, awaiting Alex. Alex chose the direction on 2026-10-30 00:27:43Z in the project thread
(cmsg_01GKYqaAGu4Vob5JHVyDmG7ASmYLKHDHqTf2XdQFiTrCuR, "Yes absolutely lets narrow it down"), answering the atproto
review of 2026-10-29. Acceptance is his typed line on the pull request that adds this record. Once accepted it
supersedes the "requested from day one" clause of plan §3's "Granular permissions + permission sets" row and the
ADR 0001 log entries that added Bluesky scopes for that reason (Phase 2 and Phase 4 review batches).

## Context
Plan §3 asks, at every sign-in, for our permission set plus Bluesky likes, posts, follows and profile writes, image
and video upload, the e-mail address, five Bluesky AppView reads and report creation. It asks for them all on day one
because adding a scope later makes every member consent again. Today only the permission set, image upload (avatar
and banner) and the e-mail address are used.

The atproto docs advise the opposite: request what a feature needs and ask for more when it ships
(atproto.com/specs/oauth and the permission guides, atproto-website 0d9768d). A consent screen that lists Bluesky
posting and video upload for an app that does neither asks members to trust more than they need to, and a stolen
session would carry all of it. Statusphere (bluesky-social/statusphere-example-app dbb9773) asks for one collection.

## Decision
1. The sign-in scope is `atproto include:sh.unset.authApp blob:image/* account:email?action=read` (with the granular
   fallback for a server without permission sets).
2. Each later feature adds its own scope in the pull request that ships it, and that PR states the re-consent: Bluesky
   reads (Phase 4 feeds), Bluesky writes ("also post to Bluesky", likes, follows), `blob:video/*` (Phase 4 video) and
   report creation (Phase 5).
3. The permission set is unchanged: it holds only our own `sh.unset.*` collections, and its own rules stand (an
   addition reaches existing grants at the next refresh and needs Alex's approval; a removal is refused).

## Alternatives
- **Keep asking for everything on day one.** One consent screen for the life of the account. Rejected by Alex: it
  grants Bluesky write access and video upload that nothing uses.
- **Ask per feature at the moment of use (incremental consent).** The best experience, but the library and the PDS
  re-run a full authorization for any added scope, so it is the same re-consent with more code. Left for later.

## Consequences
- A refresh keeps a grant's scope: the authorization server rebuilds it from the scope first granted
  (@atproto/oauth-provider `token/token-manager.ts`, `rotateToken`), so refreshing never adds a new scope. The PR that
  adds a scope therefore also adds it to `grantCovers`' required grant (infrastructure/pds/oauth/scopes.ts), and a
  member whose grant lacks it is sent through sign-in and sees one consent screen. The Phase 4 and 5 steps that need
  these scopes must plan for it (the book's P2.04 and Phase 4 text carry a note).
- Existing grants keep the old, wider scope through every refresh until the member signs in again; nothing is
  revoked early. Narrowing what we ask for never widens a grant.
- `grantCovers` (infrastructure/pds/oauth/scopes.ts) already requires only the permission set, image upload and the
  e-mail address, so sign-in behaves the same.

## Compliance
`shared/lexicons/src/scope.test.ts`: `scope_string_pinned`, `scope_fallback_pinned` (both red before the change) and
`scopes_request_no_bluesky_or_unused_scope`. `infrastructure/pds/oauth/scopes.test.ts` stays green.
