# 0006 — Private likes, comments and follows are shown to their target

Status: accepted (Alex, 2026-10-04 17:40Z, "Show target" on the plan thread's card). Decision 39 in the plan.

## Context
A member with "Posts and follows" private likes a video, comments on it or follows someone on
unset.sh. Nothing is written to the network; the record stays in unset.sh until it can live in the
member's own atproto space (decision 38). The plan review (finding R3-05) asked what the other
person sees. The card offered "Show target" (recommended) and "Author only".

## Decision
The target sees it, inside unset.sh only and with the member's name: the liked author sees
"a member liked this" with the name, the followed person sees "follows you". Third parties see
nothing, the network sees nothing, and counts shown to third parties do not include private
actions. The private member is told, once, that the target can see their private likes, comments
and follows, so the privacy on offer is the real one (decision 37).

## Alternatives
- Author only: the private member alone sees their likes and follows, targets see nothing and
  counts exclude them. Declined: a like nobody receives is not a like, and a follow nobody can see
  cannot deliver posts to a followers-only reader later.
- Show target without the name ("someone liked this"). Not offered: it hides nothing a space would
  hide, since the target reads the record there, and it invites guessing.

## Consequences
Plan §11 Q2b proposal 2 is now settled; the {post, follow, like, comment} × {private, public}
table in the lexicon docs is filled at P4.00 with this rule. The slice-1 shape of these records
(decision 38) carries the target's DID as the reader. The one-time notice is UX copy for the
privacy switch. Step book: P4.18 R2 and the private-follow steps.

## Compliance
No new personal data: the record already names the member and the target. The notice is the
transparency measure (PIPEDA openness, GDPR transparency); export and erasure cover the record
as before.
