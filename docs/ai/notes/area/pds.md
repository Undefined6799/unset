---
id: pds
type: area
status: current
areas: ["[[pds]]"]
summary: "Hub for infrastructure/pds: the atproto network adapter: identity's DID and handle lookups, and the OAuth client."
code: [infrastructure/pds/index.ts]
sources: []
importance: normal
related: ["[[identity]]", "[[net-guard]]", "[[alice-bob-pds-password]]", "[[seal]]"]
replaced_by: null
tags: [area, pds]
checked: 2026-10-28
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
from our pieces only: the sealed stores (`infrastructure/postgres/oauthStores.ts`; [[seal]]), the advisory lock, net-guard's
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
sends no second token request, and a second login replacing the stored token set. P2.05s: `authorize` also takes
`prompt: "none"`; a callback error that means the server needs a page (`login_required`, `consent_required`,
`interaction_required`, `account_selection_required`) returns `interaction_required` with the appState, so the route
can ask again. The library skips its `iss` check on an error response, so nothing is trusted from it but the state.

**PDS calls (P2.07).** `pds-call.ts` is the only place that calls `client.restore(` or `new Agent(`. It classifies
failures into `ok`, `transient`, `auth_dead`, `scope_missing` and `rejected`. A dead grant ends the DID's sessions
through an injected `endSessions` (`destroyAllForDid`); this package cannot import `infrastructure/session`. A
handshake, a 429 or an outage does not. A DPoP nonce rotation against the dev PDS
(`pdsCall.dev_pds_nonce_rotation`, book P2.07) is planned and not built; no test on main covers it.
The book's `isAuthFatal` had no caller and was removed (P0.05 cleanup): `restoreOutcome` classes a refresh and
`isDpopNonceHandshake` a handshake. `xrpcFromSession` and `PDS_UPLOAD_TIMEOUT_MS` are not exported from the index;
the book's upload step (phase 2) re-exports the constant when a route first passes it as `timeoutMs`.

**The profile record (Alex 2026-10-23).** `profile-record.ts` reads the member's `sh.unset.profile` record (rkey
`self`) from their own repo over `pdsCall`, as an idempotent read. `RecordNotFound` means no profile yet and returns
`null`, never a failure; any other refusal stays a failure, so an outage never reads as an empty profile. The value
comes back unparsed: `domains/profile` reads it field by field.

**Links.** [[identity]], [[net-guard]], [[alice-bob-pds-password]], [[seal]].
