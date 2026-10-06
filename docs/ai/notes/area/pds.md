---
id: pds
type: area
status: current
areas: ["[[pds]]"]
summary: "Hub for infrastructure/pds: the atproto network adapter; today identity's DID and handle lookups."
code: [infrastructure/pds/index.ts]
sources: []
importance: normal
related: ["[[identity]]", "[[net-guard]]"]
replaced_by: null
tags: [area, pds]
checked: 2026-10-06
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

**Later.** The OAuth client adapter lands in `infrastructure/pds/oauth/` (P2.04). Any `@atproto/*` import lives in
this folder only (vendor-sdk-one-adapter).

**Links.** [[identity]], [[net-guard]].
