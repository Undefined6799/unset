# 0072 — The profile chooses its page layout

Status: Accepted by Alex, 2026-11-20 04:23Z, against 6b6abe4 (his line "Merge 1824 at 6b6abe4", typed in the project
chat after that head was reviewed; merged as 89f2918). This status paragraph, the index row and the ADR 0001 acceptance
line were added afterwards in #1827. Alex approved the compact profile direction on 2026-11-20 and asked for it as an
optional layout that existing profiles keep until their owners choose it. This adds an optional field under ADR 0051
Decision 7; it changes no existing field.

## Context

The profile page today is a permanent identity side column beside the cards (ADR 0051 Decision 1 calls the profile
record "the side column"). The approved direction puts a compact avatar, name and handle header above the cards and
moves the other details into a panel under the avatar, so the cards share one content area. Alex asked that this be
opt-in at first and that the choice be stored through the existing pattern.

The choice is the member's, it should follow their profile to any reader, and it describes the whole page, not one
card. The profile record already holds the page-wide presentation choices (`avatarShape`, the `cards` order).

## Decision

1. `sh.unset.profile.layout` is an optional string, at most 32 UTF-8 bytes, with known values `sidebar` and
   `compact`. Absent or an unknown valid value renders `sidebar`, today's page, so every stored profile keeps its look
   until its owner chooses. Malformed records still fail validation.
2. `compact` shows the avatar, display name and handle in a header above the cards and the other profile details in a
   panel under the avatar. `sidebar` is the existing side column. Both draw the same profile fields and cards; the
   layout changes presentation only.
3. A save checks the choice strictly in `domains/profile` (`parseProfileLayout`): only a known value is written.
   `compact` is stored verbatim; choosing `sidebar` omits the field, since that is what absence means. A save that
   does not send the field keeps the stored value, including one from a future client.
4. A form that shows the choice always posts it and shows an unknown stored value as `sidebar`, so saving from it
   stores `sidebar` over an unknown value, as ADR 0068 does for a card's surface. Fields we do not define stay kept
   by the existing record merge (ADR 0038).

## Consequences

The [Lexicon specification](https://atproto.com/specs/lexicon), "String" and "Lexicon Evolution", read 2026-11-20,
permits new optional fields and defines `knownValues` as open suggestions, not a closed set. No enum or schema
default is added. The generated validator (`@atproto/lex-schema` 0.2.11, `dist/schema/string.js`, `validateInContext`) checks only type and byte
length for an open `knownValues` string. The published snapshot is unchanged.

ADR 0051 Decision 1 named the profile record "the side column only"; its fields are still the identity fields, and
with `compact` they are drawn in a header and panel instead. Nothing in ADR 0051 is superseded.

This is presentation data in the member's own PDS record. No new personal data, permission, egress or storage is
introduced, and repository export and account erasure keep covering it. The indexer keeps the field as it keeps any
other profile field.

## Alternatives

- A per-browser or per-account setting in our database: the choice would not travel with the member's record, and
  another reader of the record could not show the page as its owner chose.
- A boolean such as `compact: true`: cannot grow to a third layout without another field; an open string can.
- Switching every profile at once: Alex asked for an opt-in first, so existing pages do not change under their
  owners.

## Compliance

`domains/profile/profile.test.ts` covers the default, unknown values, strict input, clearing and preservation;
`shared/lexicons/src/limits.test.ts` holds a record at the byte limit and one past it; the save form's test covers
a known, unknown and repeated value; the index plan test keeps the field. Acceptance is Alex's line on the pull
request that adds this record.
