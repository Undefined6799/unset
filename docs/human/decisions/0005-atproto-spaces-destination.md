# 0005 — Atproto Spaces is the destination for private data

Status: accepted (Alex, 2026-10-04 17:29Z, typed in the plan thread). Decision 38 in the plan.

## Context
The plan kept private likes, comments, follows and drafts in the app database (§5.4, §11 Q2b
proposal 2) and listed atproto Spaces as something to watch (review-later item 5). Alex asked at
14:04Z: "instead of making our database for private we should consider using the spaces from
atproto." The check that followed found that Spaces is proposal 0016, which calls itself "a
proposal, not the final specification"; its implementation lives on an unmerged branch of the
atproto repository and needs a spaces-compatible PDS; it is access control, not encryption; and
it ships with no security review and no backups. The plan runs the official unpatched PDS and §9
forbids patched upstreams. Alex answered at 17:29Z: "let's plan on using spaces."

## Decision
Spaces is the destination for every piece of private data a user owns: private likes, comments
and follows, and drafts. Until Spaces is in the official PDS release and in the specification, that
data stays in the app database, but from the first slice it is shaped as one record per item in
our own lexicon, keyed as a space repository would key it, so that the move is a copy, not a
redesign. The move is checked at Phase 4, when social posts are built, and happens when both
conditions hold. The alpha is not used before then.

## Alternatives
- Run the alpha now on a spaces-compatible PDS. Rejected: it means a patched upstream (plan §9),
  no security review and no backups for user data, on a format that says it will change.
- Keep private data in the app database with no target shape. Rejected: Alex wants the data in
  the user's own repository, and shaping it now costs little.

## Consequences
Plan §3 row and §11 Q2b proposal 2 restated. Card 3 (private likes and follows shown to their
target) is read in this light: in a space the target is a reader of the record. The step book
shapes the slice-1 private records (lexicon, keys) to match a space repo, and Phase 4 carries a
check of the Spaces status with a stop-and-ask if the conditions are not met. Export and erasure
(GDPR) keep covering the app-database copy until the move.

## Compliance
No new personal data; the same data changes its intended home. The privacy notice says private
data is held by unset.sh until it can live in the user's own repository. The move itself will need
its own security review (engineering rule SE-6) and a backup answer for space data before it is
turned on.
