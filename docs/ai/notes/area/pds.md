---
id: pds
type: area
status: current
areas: ["[[pds]]"]
summary: "Hub for infrastructure/pds: the atproto network adapter: identity's DID and handle lookups, and the OAuth client."
code: [infrastructure/pds/index.ts]
sources: []
importance: normal
related: ["[[identity]]", "[[net-guard]]"]
replaced_by: null
tags: [area, pds]
checked: 2026-10-15
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

**Links.** [[identity]], [[net-guard]].
