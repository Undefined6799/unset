---
id: pds
type: area
status: current
areas: ["[[pds]]"]
summary: "Hub for infrastructure/pds: the atproto network adapter: identity's DID and handle lookups, and the OAuth client."
code: [infrastructure/pds/index.ts]
sources: []
importance: normal
related: ["[[identity]]", "[[net-guard]]", "[[alice-bob-pds-password]]"]
replaced_by: null
tags: [area, pds]
checked: 2026-10-23
---
# pds

**What it owns.** The atproto network behind small contracts. Today that is `identity-network.ts`, which
implements the identity domain's `IdentityNetwork` port on [[net-guard]] (ADR 0013).

**How it works.**
- DID `plc` documents go under the fixed `plc` egress policy; `did:web` documents and handle domains go under
  `atproto`.
- TXT lookups use net-guard's c-ares lookup.
- Each net-guard error code maps to one of the domain's three failures (`unavailable`, `refused`,
  `no_such_host`); any other error is a programming error and is thrown.
- The domain cannot widen its egress: `plc` is bound to the configured PLC host, and the byte cap is enforced here
  too.

**The OAuth client (P2.04, ADR 0021).** `oauth/oauth-client.ts` builds the one `@atproto/oauth-client-node` client
from our pieces only: the sealed stores (`infrastructure/postgres/oauthStores.ts`), the advisory lock, net-guard's
`libraryFetch` and `oauth/identity-resolvers.ts`, which answers the library's handle and DID lookups through the
identity domain (the one file outside it allowed to name `alsoKnownAs`). `oauth/scopes.ts` decides whether a grant
covers what a session needs, with the library's matcher. Its `onSessionDeleted` hook only logs: the library fires it
on every callback, so it must never end app sessions. Any `@atproto/oauth-client-node` import lives in this folder only
(vendor-sdk-one-adapter), tests included.

**Starting a sign-in (P2.05).** `oauth/sign-in.ts` calls the library's `authorize` with our appState, retries once
with the written-out scope when the server answers `invalid_scope` (it cannot resolve our permission set), and turns
the library's errors into five outcomes: `handle_unverified`, `handle_not_found`, `identity_unavailable`,
`pds_unreachable`, `failed`. Two of them rest on library internals, the identity step's message prefix and the
"does not include the handle" message; `sign-in.test.ts` runs the real client against a stand-in server, so a
library upgrade that changes either fails there.

**Completing it (P2.06).** `completeAuthorization` in the same file hands the callback query to the library, which
spends its state, checks `iss`, exchanges the code and checks the token's `sub` against its DID document's PDS and
issuer. It returns the DID, issuer, appState and the granted scope (read from the stored set without a refresh) and a
`revoke`; failures are `consent_denied`, `expired` (no stored state: unknown, expired or replayed), `pds_unreachable`
and `failed`. The interface decides the rest (nonce, expected account, grant, session). `sign-in.test.ts` also pins
the PKCE verifier against the PAR challenge, a `sub` whose issuer is not the token server, a replayed callback that
sends no second token request, and a second login replacing the stored token set.

**PDS calls (P2.07).** `pds-call.ts` is the only place that calls `client.restore(` or `new Agent(`. It classifies
failures into `ok`, `transient`, `auth_dead`, `scope_missing` and `rejected`. A dead grant ends the DID's sessions
through an injected `endSessions` (`destroyAllForDid`); this package cannot import `infrastructure/session`. A
handshake, a 429 or an outage does not. `pdsCall.dev_pds_nonce_rotation` needs the local compose stack and is not
in the unit tests.

**The profile record (Alex 2026-10-23).** `profile-record.ts` reads the member's `sh.unset.profile` record (rkey
`self`) from their own repo over `pdsCall`, as an idempotent read. `RecordNotFound` means no profile yet and returns
`null`, never a failure; any other refusal stays a failure, so an outage never reads as an empty profile. The value
comes back unparsed: `domains/profile` reads it field by field.

**Links.** [[identity]], [[net-guard]], [[alice-bob-pds-password]].
