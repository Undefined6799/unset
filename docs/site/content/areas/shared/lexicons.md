---
title: lexicons
weight: 6
---

The `sh.unset.*` record schemas, their validator, the field limits and the OAuth scope strings. Package `@unset/shared-lexicons`. `published.lock.json` is `{}`.

## Owns

| Path | Role |
| --- | --- |
| `shared/lexicons/schemas/` | Our lexicon JSON |
| `shared/lexicons/published/` | Snapshot JSON. One file: `sh.unset.profile.json`. |
| `shared/lexicons/published.lock.json` | `{}`. Names no NSID. |
| `shared/lexicons/vendor/` | Bluesky lexicons we read, copied from tag `@atproto/api@0.23.0`. Hashes are in `vendor/SOURCE.md`. |
| `shared/lexicons/generated/` | `lex build` output, checked in. Its `tsconfig.json` sets `exactOptionalPropertyTypes` off. Do not edit it. |
| `shared/lexicons/src/validate.ts` | `validateRecord`. `write` refuses fields the schema does not name. `read` does not. |
| `shared/lexicons/src/limits.ts` | `LIMITS` and `IMAGE_ACCEPT`. `limits.test.ts` holds the numbers equal to the schemas. |
| `shared/lexicons/src/scope.ts` | `scopeString` and `scopeStringFallback` |
| `shared/lexicons/scripts/build.ts` | Schema checks and generation |
| `shared/lexicons/scripts/breaking-check.ts` | `publishedProblems` runs `breakingProblems` on `schemas/<nsid>.json` against `published/<nsid>.json`. Refusals are in the table under the commands. |

Our schemas:

| File | NSID |
| --- | --- |
| `schemas/sh.unset.profile.json` | `sh.unset.profile` |
| `schemas/sh.unset.section.json` | `sh.unset.section` |
| `schemas/sh.unset.follow.json` | `sh.unset.follow` |
| `schemas/sh.unset.authApp.json` | `sh.unset.authApp` |

Snapshots:

| File | NSID |
| --- | --- |
| `published/sh.unset.profile.json` | `sh.unset.profile` |

`published/sh.unset.profile.json` has the same contents as `schemas/sh.unset.profile.json`. Records of `sh.unset.profile` are already in members' repositories, so this NSID has a snapshot (`publishedProblems` in `breaking-check.ts`).

`NSID` in `shared/lexicons/index.ts` repeats those four. `NSID.authApp` is the same string as `PERMISSION_SET_NSID` in [config](../config/). This package may not import `shared/config`. No file under `shared/config/` imports this package. `permanent.test.ts` pins `PERMISSION_SET_NSID` to the string and to the ADR 0025 row. It does not import `NSID`.

Vendored files (`vendor/SOURCE.md`; sha256 of the JSON value):

| File | sha256 |
| --- | --- |
| `app.bsky.actor.profile.json` | `35ae081b54c2e0e266f4ab54fdd563873c2d95964b719a428545a8311155224f` |
| `com.atproto.label.defs.json` | `8ddce1a7ec654fe807ef354cffbd2e0ecc16c937b3f91b554604764be1b28c4b` |
| `com.atproto.repo.strongRef.json` | `66379e298b8ea897ef94524bdbf9abf7ae2bafcd97f0a82cb716139e350dee9e` |

`validateRecord` also accepts `app.bsky.actor.profile`. That record is not strict on write.

Consent text is English. `build.ts` sets `LANGUAGES` to `en`.

From the repository root:

```sh
node shared/lexicons/scripts/build.ts
node shared/lexicons/scripts/build.ts --check
node shared/lexicons/scripts/breaking-check.ts
```

`--check` exits 1 when `generated/` is stale. `publishedProblems` takes every key of `published.lock.json` and every `published/*.json` name, and runs `breakingProblems` with `schemas/<nsid>.json` as the next document and `published/<nsid>.json` as the published one.

`breakingProblems` walks definitions the published document already has, then each of those objects' fields and each array's `items`. A new optional field is allowed. An open union (`closed` is not `true`) that already has `refs` may add refs, and may drop that list. These changes are refused:

| Change | Result |
| --- | --- |
| `maxLength`, `maxGraphemes`, `maxSize`, `maximum`, `minLength`, `minGraphemes` or `minimum` is added, removed or set to another value | refused |
| An `enum` or `accept` value is added or removed, or that list is added or removed | refused |
| `closed` becomes `true`, or stops being `true` | refused |
| A `refs` value is removed; a closed union gains a `refs` value or loses its `refs` list; a `refs` list is added where none was published | refused |
| `type`, `format`, `const`, `ref` or `default` is added, removed or set to another value | refused |
| A definition or field is removed, a record `key` changes, or a field is newly `required` | refused |

When the published `defs.main.type` is `permission-set`, scope and consent rules apply instead. A removed scope is refused. An added scope, or a change to `title`, `title:lang`, `detail` or `detail:lang`, needs `--approved-by-alex=` followed by digits that do not start with `0`. Any other value of that flag exits 2.

| NSID source | On this tree |
| --- | --- |
| Keys of `published.lock.json` | None. The file is `{}`. |
| `published/*.json`, name without `.json` | `sh.unset.profile` |

The profile snapshot is compared. The two files have the same contents.

## May import

Rows `shared-ui-lexicons` and `shared-lexicons-scripts`.

| From | May reach |
| --- | --- |
| `shared/lexicons/`, except `scripts/` | Its own folder and npm |
| `shared/lexicons/scripts/` | `shared/lexicons/`, npm, and Node built-ins `fs`, `path`, `os`, `url`, `child_process` |

`vendor-sdk-one-adapter`: `@atproto/lex*` is imported only in this package. `lexicon-scripts-not-imported`: nothing outside `scripts/` imports that folder.

Declared in `shared/lexicons/package.json`:

| Dependency | Version | Kind |
| --- | --- | --- |
| `@atproto/lex-json` | 0.1.7 | dependency |
| `@atproto/lex-schema` | 0.2.8 | dependency |
| `@atproto/lex` | 0.3.14 | devDependency |
| `@atproto/lex-document` | 0.1.13 | devDependency |

Who may import the index is the [shared](../) table. The domain row names `shared/lexicons/` specifically. On this tree `domains/profile/profile.ts` imports `LIMITS` and `validateRecord`. Product importers are that file, `infrastructure/pds/oauth/scopes.ts` and `infrastructure/pds/oauth/sign-in.ts`.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/lexicons/index.ts` |
| `validateRecord`, `NSID`, `LIMITS`, `IMAGE_ACCEPT`, `scopeString`, `scopeStringFallback` | re-exported from `index.ts` |
| Build | `shared/lexicons/scripts/build.ts`. Nothing outside `scripts/` imports it. |
| Breaking check | `shared/lexicons/scripts/breaking-check.ts`. Same rule. |

## Data

No Postgres schema, role or table. The record contract is the JSON under `schemas/` and `vendor/`. `published.lock.json` names no NSID. The snapshot `publishedProblems` compares is `published/sh.unset.profile.json`.
