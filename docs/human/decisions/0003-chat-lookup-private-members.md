# 0003 — Chat does not reveal private members by handle

Status: accepted (Alex, 2026-10-04 13:46Z, "Close it" on the plan thread's card). Decision 36 in the plan.

## Context
Decision 35 (D7) made a private profile answer like a missing one, so nobody can tell "exists but
private" from "absent" on the profile page, in the directory or through the read API. The plan
review against the engineering rules (finding R3-01, rule SE-2) found that chat's handle lookup
still answered "found" for a private member and "not found" otherwise, and the plan said "a private
account can still be messaged by handle". Any signed-in person could therefore test whether a handle
belongs to a member, which is the signal D7 closed.

## Decision
Chat's handle lookup answers "no such member" for a private member exactly as for a stranger. A
private person is reached only from a conversation that already exists or from a message request
they sent. Their Everyone/Nobody message-request setting may reopen lookup for them later, per
person, as a later decision if the product wants it.

## Alternatives
- Keep messaging by handle as the one written exception to D7: simpler for people who know a
  handle, but it reopens the membership oracle for every signed-in user.
- Answer "found" only to members the private person already follows: leaks the follow graph through
  timing and differs from the profile page's behaviour.

## Consequences
Plan §5.6 is reworded. Step P6.06a's resolve endpoint and its justification change to match, with a
test that a private-profile fixture and an unknown handle give byte-identical answers. Nothing in
decision 12 (message requests are invite-only, no text before accept) changes.

## Compliance
Reduces what a private account leaks (OWASP API3:2023, Anderson ch. 11); no new personal data.
