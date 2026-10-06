---
id: identity
type: area
status: current
areas: ["[[identity]]"]
summary: "Hub for domains/identity: DID and handle syntax, resolution and the two-way handle check."
code: [domains/identity/index.ts]
sources: []
importance: normal
related: ["[[pds]]", "[[net-guard]]", "[[node-dns-lookup-hides-nxdomain]]"]
replaced_by: null
tags: [area, identity]
checked: 2026-10-06
---
# identity

**What it owns.** Who an account is (plan §2 rules 1 and 13, §5.2). Product rules only; it never touches the
network itself.

**Files.**
- `syntax.ts`: parses DIDs and handles into branded types; nothing unparsed reaches the network.
- `resolve-did.ts`: DID to DID document. "Does not exist" and "could not tell" stay apart; only successes are cached.
- `resolve-handle.ts`: handle to DID, by TXT record first, then the well-known HTTPS path.
- `did-doc.ts`: reads the atproto fields of a DID document; `alsoKnownAs` is passed on raw.
- `verify-handle.ts`: shows a handle only when it resolves back to the same DID. Trusted base.
- `contract.ts`: the `IdentityNetwork` port, one GET and one TXT lookup, with three failures.

**How data flows.** Interface → identity → `IdentityNetwork` → [[pds]] adapter → [[net-guard]] → network. Every
outage is `unavailable` and fails closed; it is never read as a missing account.

**Links.** ADR 0013 (the port, DNS on c-ares), [[pds]], [[net-guard]], specs at https://atproto.com/specs/did and
https://atproto.com/specs/handle.
