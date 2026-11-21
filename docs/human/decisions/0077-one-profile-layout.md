# 0077 — The profile page has one layout

Status: Accepted by Alex, 2026-11-21 00:02Z, against af83763 (his line naming that head, given after it was reviewed;
merged as 7185403). This status paragraph, the index rows and the ADR 0001 acceptance line were added afterwards in
#1855. Supersedes [0072](0072-profile-page-layout.md). 0072's own status line is left as it was until the ADR check can
mark a status that runs over several lines as superseded; the index and the ADR 0001 log record the supersession.

## Context

ADR 0072 added an optional `sh.unset.profile.layout` field so a member could choose the side column (`sidebar`, the
default) or the compact header (`compact`). Alex tried the compact header on staging on 2026-11-20 and asked to keep
only it: "we're going to keep like only the compact layout. So we'll get rid of the other card like thing."

The field was never published: `shared/lexicons/published/sh.unset.profile.json` has no `layout`. The project is not
live, so no member and no other client depends on it.

## Decision

1. Every profile page is drawn with the profile header above the cards (what ADR 0072 called `compact`). There is no
   side column and no layout choice.
2. `layout` is removed from the `sh.unset.profile` schema and its generated code, along with `parseProfileLayout`,
   `readProfileLayout`, the save's `layout` input and the Settings › Profile choice.
3. A stored record that still has `layout` keeps it as a field we do not define. The record merge keeps such fields
   (ADR 0038; [Lexicon specification](https://atproto.com/specs/lexicon), "Authority and Control", read 2026-11-20),
   and nothing reads it.

## Consequences

The schema loses an optional field before it was ever published, so the published snapshot is not affected and no
migration is needed. One layout means one set of profile components, tests and docs. A different layout later would
need a new decision and, if members choose it, a new field. No personal data, permission, egress or storage changes.

## Alternatives

- Keep the field and always draw compact: this leaves a contract value that means nothing, and code that reads it.
- Keep both layouts with compact as the default: Alex asked for one.

## Compliance

`domains/profile/profile.test.ts` keeps an undefined stored field on save; `tests/e2e/profile-header.spec.ts` and
`profile-layout.spec.ts` check the one layout, with and without script and on a 320px phone; the Settings form test
lists no layout input. Acceptance is Alex's line on the pull request that adds this record.
