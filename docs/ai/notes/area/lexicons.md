---
id: lexicons
type: area
status: current
areas: ["[[lexicons]]"]
summary: "Hub for shared/lexicons: the sh.unset.* record and permission-set schemas, their validator, limits and OAuth scope."
code: [shared/lexicons/index.ts, shared/lexicons/scripts/build.ts, shared/lexicons/scripts/breaking-check.ts]
sources: []
importance: high
related: ["[[identity]]", "[[pds]]"]
replaced_by: null
tags: [area, lexicons]
checked: 2026-11-21
---
# lexicons

**What it owns.** The public record contract (plan §3; ADR 0086): `sh.unset.profile` (who the member is, plus the
`cards` list of at:// addresses that says which cards show, in order), `sh.unset.card` (one block plus optional
width and surface), the blocks `sh.unset.block.{text,links,showcase,buttons,images}` with their shared
`sh.unset.block.defs`, and the permission set `sh.unset.authFull`. `sh.unset.section`, `sh.unset.follow`,
`sh.unset.authApp` and `sh.unset.defs` went with #1933 (P1.31t). Once a schema is published (P1.35) other apps rely
on it, so a change is close to permanent.

**Files.**
- `schemas/`: our lexicon JSON. `vendor/`: the Bluesky lexicons we read, copied from tag
  `@atproto/api@0.23.0`, each pinned by the sha256 of its JSON value in `vendor/SOURCE.md`.
- `generated/`: `lex build` output, checked in, with its own tsconfig (the output assumes
  `exactOptionalPropertyTypes` off). Never edit it: run `node shared/lexicons/scripts/build.ts`.
- `src/validate.ts`: `validateRecord(nsid, value, mode)`. `write` also refuses unknown fields, because
  lexicon objects accept them; `read` (records from the network) does not. The unknown-field walk follows local
  `#refs` and refs into `sh.unset.defs`; a ref to any other lexicon is not followed, so add its defs to `SHARED`.
- `src/limits.ts`: the limits the UI and the domain show; a test holds them equal to the schemas.
- `src/scope.ts`: the OAuth scope string, and the expanded fallback for a PDS without permission sets.
- `scripts/build.ts`: schema checks (strict keys, flat NSIDs, English consent text; French comes with the i18n slice) and generation.
- `scripts/breaking-check.ts`: refuses any changed, added or dropped size or length limit
  (atproto.com/specs/lexicon, "Lexicon Evolution"; widening was allowed until P1.31j), a lost or gained enum or
  `accept` value, a union opened or closed, or a closed union's new ref (P1.31k), or a changed `default` (an absent
  `listed` must stay not listed) on a published schema; additions to
  the permission set need Alex's approval and removals are refused. It also holds every `published/<nsid>.json`
  snapshot with no lock entry yet. `published/sh.unset.profile.json` holds the ADR 0086 profile, replaced in
  #1933 because nothing was published yet.

**Pitfalls.**
- `@atproto/lex-document`'s parser keeps unknown keys, so build.ts checks keys itself from `.shape`.
- Blob fields validate only after `jsonToLex` (`@atproto/lex-json`); raw JSON `{$link}` fails.
- `generate()` builds in `mkdtemp(<os tmpdir>/unset-lexicons-)` and writes nothing in the repository
  (P1.38a): a folder that appeared and vanished in shared/ broke the docs test's walk. biome panics on
  paths outside its root, so each built file is formatted through `--stdin-file-path=` its generated/ path.
- `NSID.authFull` repeats `PERMISSION_SET_NSID` in shared/config (`sh.unset.authFull`); keep them equal.

**Links.** [[identity]], [[pds]].
