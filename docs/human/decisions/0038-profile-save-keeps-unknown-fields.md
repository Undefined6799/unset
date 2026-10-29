# 0038 — A profile save keeps stored fields the lexicon does not define

Status: Proposed (awaiting Alex). Supersedes one clause of ADR 0037 Decision 2 ("validates the result with the
lexicon's strict validator"); the rest of ADR 0037 is unchanged.

## Context
ADR 0037 Decision 2 says a save keeps every stored field it was not sent, then validates the whole result with the
lexicon's strict validator. That validator refuses any field the schema does not define. So a profile that holds a
field this release does not know cannot be saved at all: a field another client wrote, or one a newer release of
ours added as an optional field (the only change a published lexicon allows). Older deployments, and staging
running an older image, would lock members out of editing.

The atproto docs say the opposite. atproto.com/specs/lexicon, "Authority and Control" (atproto-website 0d9768d,
2026-10-29): unexpected fields in a record "should be ignored", at worst with warnings, and a record should be kept
with its extra fields rather than clobbered; guides/lexicon-style-guide: adding optional fields is how a lexicon
evolves. Statusphere's ingester (bluesky-social/statusphere-example-app dbb9773) validates with the lenient parser.
The atproto review of 2026-10-29 ranked this first.

## Decision
1. A profile save checks the merged record in read mode: every field the lexicon defines must be valid, and fields it
   does not define are kept unchanged and not checked. A record another client broke (a defined field with a wrong
   type or out of bounds) is still refused, never written back.
2. The fields a save sets come only from `parseProfileFields`, so they are always fields the lexicon defines.
3. The strict write mode stays in `shared/lexicons` for records we build entirely ourselves.

## Alternatives
- **Drop unknown fields on save.** The save goes through, but silently deletes another client's or a newer
  release's data. Rejected: the docs say keep them.
- **Keep refusing.** Rejected: one optional field added by a newer release locks older deployments out.

## Consequences
An unknown stored field is written back as it was, unchecked. It is the member's own data in the member's own repo,
we never render it, and the page reader (`readProfileRecord`) still reads only defined fields one by one, so it adds
no output surface.

## Compliance
`domains/profile/profile.test.ts`: "a stored field this version does not know is kept and the save goes through"
(red before the change) and "a stored record another client broke is refused, never written back" (still green).
Acceptance is Alex's line on the pull request that adds this record.
