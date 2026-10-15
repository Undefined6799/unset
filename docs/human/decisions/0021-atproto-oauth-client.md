# 0021 — @atproto/oauth-client-node as the OAuth client

Status: Proposed (awaiting Alex in the P2.04 pull request)

## Context
Sign-in (slice 1) needs an atproto OAuth client: a confidential client with `private_key_jwt`, PAR, PKCE and
DPoP-bound tokens, as atproto.com/specs/oauth requires. It is a runtime dependency of the web server and holds every
member's tokens, so it is expensive to reverse (D8). The plan (§3, §5.3) and the book (P2.04) name Bluesky's client.

## Decision
1. `@atproto/oauth-client-node` 0.5.9, `@atproto/jwk-jose` 0.2.4 and `@atproto/oauth-scopes` 0.5.13, pinned exactly in
   `infrastructure/pds/package.json`, each past the 7-day `min-release-age`.
2. Only `infrastructure/pds/` imports `@atproto/oauth-client-node` (dependency-cruiser `SDK_ADAPTERS`, already listed).
3. The library gets our pieces, never its defaults: the sealed Postgres stores (`infrastructure/postgres/oauthStores.ts`),
   the advisory lock (`createRequestLock`), net-guard's `libraryFetch`, and the identity domain's resolvers
   (`infrastructure/pds/oauth/identity-resolvers.ts`). Its own handle resolver, DNS and local lock are never used.
4. Its `onSessionDeleted` hook only logs a reason word; it ends no app session (P2.04 step 7).

## Alternatives
- Writing the OAuth client ourselves: rejected; PAR, DPoP nonces, client assertions and token refresh are exactly the
  code an audit should find already reviewed upstream.
- `@atproto/oauth-client-browser` in the page: rejected; tokens would live in the browser, and the plan keeps them
  sealed on the server.

## Consequences
The library refreshes tokens itself when a session is restored; the advisory lock keeps two replicas from spending one
refresh token. It fires `onSessionDeleted` on every callback (it revokes the previous set first), so nothing may hang
app sessions on that hook. A removed client key logs out the sessions bound to it at their next refresh, which the
rotation runbook guards (`docs/human/runbooks/oauth-key-rotation.md`). The dependency audit, licence check and SBOM
cover the closure (`@atproto/oauth-client`, `@atproto/jwk*`, `@atproto-labs/*`, `jose`).

## Compliance
dependency-cruiser keeps the client in one folder; the exact pins are checked by the dependency guard; the store,
scope and adapter tests run against the pinned versions. Reviewed when 0.6 changes the store, hook or lock interfaces.
