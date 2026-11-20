# 0068 — Each profile card chooses its outer surface

Status: Accepted by Alex, 2026-11-20 01:23Z, against 1e38138 (his line "Merge 1815 at 1e38138", typed in the project
chat after the coordinator had reviewed that head). This status paragraph, the index row and the ADR 0001 acceptance
line were added afterwards in #1817. Alex approved the Filled / Outlined / Plain direction and requested
implementation on 2026-11-19. This adds an optional field under ADR 0051 Decision 7; it changes no existing required field.

## Context

The same reusable cards should support different personal styles without duplicating card types or content.
Removing the outer background lets text and collections sit directly on the profile page.

## Decision

1. `sh.unset.section.surface` is an optional string, at most 32 UTF-8 bytes, with known values `filled`,
   `outlined`, and `plain`. Absent or unknown valid values render Filled. Malformed records still fail validation.
2. Filled preserves each card kind's existing appearance. Outlined is transparent with a fine neutral border
   and no shadow. Plain has no outer fill, border or shadow. Spacing, inner tiles, dividers, buttons and content
   stay the same. Contact's decorative edge belongs only to Filled. Owner controls and focus indicators remain.
3. The editor offers one native radio choice per card, also working without JavaScript. New choices are checked
   strictly in the domain. Explicit Filled omits the stored field; Outlined and Plain are stored verbatim.
4. An older editor that omits surface input preserves the stored value. A new card without it is Filled.
   Explicitly choosing a known surface replaces any previous value, including one from a future client.
   This editor always posts its selected surface, and it shows an unknown stored value as Filled, so saving
   any change to such a card from this editor stores Filled; the same holds for `width` today.
   Unrelated fields and the original creation time remain preserved by the existing record merge.

## Consequences

The [Lexicon specification](https://atproto.com/specs/lexicon), String and Lexicon Evolution, read 2026-11-19,
permits optional additions and defines knownValues as open suggestions. No enum or schema default is added.
Pinned `@atproto/lex-schema` 0.2.11, `dist/schema/string.js:25`, checks type and byte limits; generated optional
string validators retain the open knownValues contract. The published snapshots are unchanged.

A save writes every field the editor shows, so an editor left open in another tab puts back the surface it
loaded, as it already does for width and content. Refusing a save made from an older copy of the record is
left for a later step.

This is presentation data in the existing PDS record. No new personal data category, permission, egress or
storage system is introduced. Repository export and account erasure keep covering it.

## Alternatives

- A profile-wide theme alone cannot mix a plain introduction with an outlined collection.
- A separate card kind for each treatment would duplicate behavior and make later changes harder.

One optional envelope field serves all four existing card kinds and future kinds; readers without it continue
showing their existing treatment.

## Compliance

Domain and form tests cover compatibility, strict input and persistence; browser tests cover editor saves,
reloads, both themes, narrow screens, keyboard focus and the no-script retry path.
