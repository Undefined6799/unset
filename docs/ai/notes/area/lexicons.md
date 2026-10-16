---
id: lexicons
type: area
status: current
areas: ["[[lexicons]]"]
summary: "Hub for shared/lexicons: the sh.unset.* record and permission-set schemas, their validator, limits and OAuth scope."
code: [shared/lexicons/index.ts, shared/lexicons/scripts/build.ts]
sources: []
importance: high
related: ["[[identity]]", "[[pds]]"]
replaced_by: null
tags: [area, lexicons]
checked: 2026-10-12
---
# lexicons

**What it owns.** The public record contract (plan §3): `sh.unset.profile`, `sh.unset.section`,
`sh.unset.follow` and the permission set `sh.unset.authApp`. Once a schema is published (P1.35) other
apps rely on it, so a change is close to permanent.

**Files.**
- `schemas/`: our lexicon JSON. `vendor/`: the Bluesky lexicons we read, copied from tag
  `@atproto/api@0.23.0`, each pinned by the sha256 of its JSON value in `vendor/SOURCE.md`.
- `generated/`: `lex build` output, checked in, with its own tsconfig (the output assumes
  `exactOptionalPropertyTypes` off). Never edit it: run `node shared/lexicons/scripts/build.ts`.
- `src/validate.ts`: `validateRecord(nsid, value, mode)`. `write` also refuses unknown fields, because
  lexicon objects accept them; `read` (records from the network) does not.
- `src/limits.ts`: the limits the UI and the domain show; a test holds them equal to the schemas.
- `src/scope.ts`: the OAuth scope string, and the expanded fallback for a PDS without permission sets.
- `scripts/build.ts`: schema checks (strict keys, flat NSIDs, English consent text; French comes with the i18n slice) and generation.

**Pitfalls.**
- `@atproto/lex-document`'s parser keeps unknown keys, so build.ts checks keys itself from `.shape`.
- Blob fields validate only after `jsonToLex` (`@atproto/lex-json`); raw JSON `{$link}` fails.
- `NSID.authApp` repeats `PERMISSION_SET_NSID` in shared/config; step P1.31c adds the test that holds them equal.

**Links.** [[identity]], [[pds]].
