---
id: alice-bob-pds-password
type: how-to
status: current
areas: ["[[pds]]", "[[identity]]"]
summary: "The operator types the Alice and Bob PDS password from memory or unset-dev-secrets, never the app."
code: [docs/human/runbooks/dev-stack-secrets.md]
sources: [docs/human/decisions/0026-local-email-gate-exception.md]
importance: normal
related: ["[[pds]]", "[[identity]]"]
replaced_by: null
tags: [how-to, pds, identity]
checked: 2026-10-18
---
# Where the operator types the Alice and Bob PDS password

**When.** Signing in as the two local test accounts (ADR 0026).

**Steps.**
1. Password, DID, and email for Alice and Bob live only on the PDS, the same place as any other user's.
2. The app does not keep a parallel copy. The repository does not hold those secrets.
3. Whoever runs an agent types the PDS password themselves: from their head, or from the existing
   local stack secrets env (`unset-dev-secrets` / `docs/human/runbooks/dev-stack-secrets.md`), never
   from the app database.
4. Do not invent the password, DID, or email.

**Check.** The PDS login accepts the password you typed. The app still has no password, DID, or mailbox
store for them.

**Links.** [[pds]], [[identity]], ADR 0026.
