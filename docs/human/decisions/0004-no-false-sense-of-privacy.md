# 0004 — No false sense of privacy: show what the network can see

Status: accepted (Alex, 2026-10-04 13:50Z, typed in the plan thread). Decision 37 in the plan.

## Context
The plan review against the engineering rules asked how a member with a private profile but public
posts appears on unset.sh (finding R3-04; the Q2b matrix the plan had parked for Alex before Phase
4; step P4.00 stop-and-ask). The options were to show the public posts under a bare handle, as any
other atproto app would, or to show nothing until both privacy switches are public. Alex answered
with a rule rather than a tap: "I do not wish to create a false sense of privacy. So if a member
could be found from another appview or something like that, we should also display it."

## Decision
Whatever the network can already show about a member (a public record in their repo, a public DID
document) unset.sh shows too, and only what the network cannot see is hidden. For the Q2b matrix:
profile private with posts public shows that member's public posts under the bare handle on
`/@alice/p/{rkey}`, in feeds and in the read API, Follow lives on the post page, and `/@alice` stays
unavailable like a missing profile (decision 35, D7). The rule is a reading aid for every later
privacy question: hiding on unset.sh something that is public elsewhere is a false promise, and
unset.sh makes no such promise.

## Alternatives
- Hide everything of that member on unset.sh until both switches are public. Rejected: the posts
  stay visible in every other app, so the hiding would be a false sense of privacy.
- Keep the question open for P4.00. Rejected: the rule answers it now and later cases alike.

## Consequences
Plan §11 Q2b is restated; the Q2b table (post, follow, like, comment × private, public) is filled
with this rule at P4.00. Decision 36 stands: chat membership is not a public record, so chat keeps
answering "no such member" for a private member. Phase 6 confirms that nothing on the Matrix side
(federation profile queries, user directory) exposes membership either; if it does, that is a
federation setting to close, not a reason to reopen lookup.

## Compliance
No new personal data. The privacy notice already says anything in the repo is public; the rule keeps
the product's claims and the network's reality the same (PIPEDA openness, GDPR transparency).
