# 0024 — @atproto/api Agent as the XRPC client over an OAuth session

Status: Proposed (awaiting Alex in the P2.07 pull request)

## Context
Every call the web server makes to a member's PDS has to go through one wrapper (book P2.07, plan §2 rule 3).
That wrapper restores the OAuth session and needs an XRPC client bound to the session's fetch handler. It is a
runtime dependency, so it is expensive to reverse (D8).

## Decision
1. `@atproto/api` 0.24.2, pinned exactly in `infrastructure/pds/package.json`, past the 7-day `min-release-age`
   (published 2026-10-08).
2. Only `infrastructure/pds/pds-call.ts` constructs `Agent`. `OAuthSession` is a `FetchHandlerObject`
   (`@atproto/oauth-client` 0.8.9 `oauth-session.js` `fetchHandler`), which is what `Agent`'s constructor takes
   (`@atproto/api` 0.24.2 `dist/agent.d.ts`).
3. `@atproto/lex` 0.3.14 is the lexicon CLI, not an XRPC client. `@atproto/lex-client` may be imported only from
   `shared/lexicons` (dependency-cruiser `SDK_ADAPTERS`). The XRPC adapter already named for `infrastructure/pds`
   is `@atproto/api`.

## Alternatives
- `@atproto/lex-client` over the session fetch: rejected; the cruiser confines that package to `shared/lexicons`,
  and moving it would be a new edge.
- A hand-rolled XRPC client on `fetchHandler`: rejected; the book names `Agent`, and a second client would drift
  from the lexicon types.

## Consequences
`pdsCall` is the only restore of a member's grant for a PDS call. A dead grant deletes that DID's sessions. A
nonce handshake, a 429, a timeout or a 5xx does not. The dependency audit, licence check and SBOM cover the
closure (`@atproto/xrpc` and the API lexicon types).

## Compliance
dependency-cruiser keeps `@atproto/api` in `infrastructure/pds/`. `pds-call.guard` fails if another file builds
an Agent or calls `client.restore(`. The exact pin is checked by the dependency guard.
