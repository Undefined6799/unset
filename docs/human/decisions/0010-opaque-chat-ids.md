# 0010 — Opaque chat ids close the key-query membership leak

Status: accepted (Alex, 2026-10-04 21:44Z, "Opaque ids" on the plan thread's card, the recommendation). Decision 42 in the plan.

## Context
Decision 36 (ADR 0003) made the chat handle lookup answer "no such member" for a private member.
One hole remained: Synapse answers `POST /_matrix/client/v3/keys/query` for any local user to any
signed-in user with no shared-room check, and returns `{}` for a user that does not exist
(`synapse/handlers/e2e_keys.py`, `query_local_devices`, commit 4f55240, lines 541 to 600,
verified; spec: https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3keysquery,
which puts no visibility condition on the query). No Synapse setting closes it; the profile,
federation-profile and user-directory leaks are closed by settings. With chat ids derived from
handles (the first draft of step P6.05), any signed-in member could confirm that a handle has a
chat account, which undoes decision 36. The card offered opaque ids (recommended), a Synapse module
gating key queries to users who share a room or have a pending request, or accepting the leak.

## Decision
Every member's Matrix user id is an opaque random localpart, assigned at chat enrolment and never
derived from the handle, the DID or any other public attribute. The mapping from handle to chat id
exists only in our database and is served only by the lookup that decision 36 already gates. A
`keys/query` probe therefore needs an id that nobody can guess. Ids never change once accounts
exist, so this is settled before P6.05 and applies from the first chat account.

## Alternatives
- Synapse module gating `keys/query` between strangers: keeps readable ids, but puts our own code
  in the crypto path of every Synapse upgrade. Declined.
- Accept the leak and write it down. Declined: it contradicts decision 36.

## Consequences
Inside an existing conversation a private member appears as a raw id until step P6.00 picks one of
the three listed ways to show the verified handle to room-mates (display name set from the
verified handle, a bot-posted verification, or a room-state field our client renders); the public
member's display name is set from the verified handle at enrolment. The step book's P6.00 stop on
this question is lifted; P6.05 generates and stores the opaque localpart. Element and Cinny render
display names, not localparts, so the cost is confined to our own client (reference: element-web
`apps/web/src` member list uses `RoomMember.name`; checked at P6.00 against the pinned SDK).

## Compliance
Reduces personal data in a public identifier (data minimisation, PIPEDA and GDPR). The id is
pseudonymous, not anonymous: the mapping is personal data and joins the erasure registry and the
export.
