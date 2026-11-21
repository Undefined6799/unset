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

**What it owns.** The public record contract (plan §3): `sh.unset.profile`, `sh.unset.section`,
`sh.unset.follow`, the permission set `sh.unset.authApp`, and `sh.unset.defs` (shapes records share: `#image`, the
picture every use embeds, ADR 0070). Once a schema is published (P1.35) other
apps rely on it, so a change is close to permanent.

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
- `public-repo/` and `scripts/ci/lexicons-export.ts`: the file tree of the public copy,
  github.com/unset-sh/lexicons (ADR 0089). `.github/workflows/lexicons-mirror.yml` pushes it on a change to main;
  nothing is edited there or read back. The public `README.md` must name every lexicon and say draft while
  `published.lock.json` is `{}` (`lexicons-export.test.ts`).
  The key and how a public contribution comes across: `docs/human/runbooks/lexicons-mirror-key.md`.
- `scripts/breaking-check.ts`: refuses any changed, added or dropped size or length limit
  (atproto.com/specs/lexicon, "Lexicon Evolution"; widening was allowed until P1.31j), a lost or gained enum or
  `accept` value, a union opened or closed, or a closed union's new ref (P1.31k), or a changed `default` (an absent
  `listed` must stay not listed) on a published schema; additions to
  the permission set need Alex's approval and removals are refused. It also holds every `published/<nsid>.json`
  snapshot with no lock entry yet: `sh.unset.profile` is snapshotted because its records are live before P1.35
  publishes it (P1.31h).

**Pitfalls.**
- `@atproto/lex-document`'s parser keeps unknown keys, so build.ts checks keys itself from `.shape`.
- Blob fields validate only after `jsonToLex` (`@atproto/lex-json`); raw JSON `{$link}` fails.
- `generate()` builds in `mkdtemp(<os tmpdir>/unset-lexicons-)` and writes nothing in the repository
  (P1.38a): a folder that appeared and vanished in shared/ broke the docs test's walk. biome panics on
  paths outside its root, so each built file is formatted through `--stdin-file-path=` its generated/ path.
- `NSID.authApp` repeats `PERMISSION_SET_NSID` in shared/config; step P1.31c adds the test that holds them equal.

**Links.** [[identity]], [[pds]].
