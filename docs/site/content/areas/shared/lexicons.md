---
title: lexicons
weight: 6
---

The `sh.unset.*` record schemas, their validator, the field limits and the OAuth scope strings. Package `@unset/shared-lexicons`. Publishing the schemas is (planned). The step book names that as P1.35. `published.lock.json` is `{}`.

## Owns

| Path | Role |
| --- | --- |
| `shared/lexicons/schemas/` | Our lexicon JSON |
| `shared/lexicons/vendor/` | Bluesky lexicons we read, copied from tag `@atproto/api@0.23.0`. Hashes are in `vendor/SOURCE.md`. |
| `shared/lexicons/generated/` | `lex build` output, checked in. Its `tsconfig.json` sets `exactOptionalPropertyTypes` off. Do not edit it. |
| `shared/lexicons/src/validate.ts` | `validateRecord`. `write` refuses fields the schema does not name. `read` does not. |
| `shared/lexicons/src/limits.ts` | `LIMITS` and `IMAGE_ACCEPT`. `limits.test.ts` holds the numbers equal to the schemas. |
| `shared/lexicons/src/scope.ts` | `scopeString` and `scopeStringFallback` |
| `shared/lexicons/scripts/build.ts` | Schema checks and generation |
| `shared/lexicons/scripts/breaking-check.ts` | Compares a published schema with the current one |

Our schemas:

| File | NSID |
| --- | --- |
| `schemas/sh.unset.profile.json` | `sh.unset.profile` |
| `schemas/sh.unset.section.json` | `sh.unset.section` |
| `schemas/sh.unset.follow.json` | `sh.unset.follow` |
| `schemas/sh.unset.authApp.json` | `sh.unset.authApp` |

`NSID` in `shared/lexicons/index.ts` repeats those four. `NSID.authApp` is the same string as `PERMISSION_SET_NSID` in [config](../config/). This package may not import `shared/config`. No file under `shared/config/` imports this package. `permanent.test.ts` pins `PERMISSION_SET_NSID` to the string and to the ADR 0025 row. It does not import `NSID`.

Vendored files (`vendor/SOURCE.md`; sha256 of the JSON value):

| File | sha256 |
| --- | --- |
| `app.bsky.actor.profile.json` | `35ae081b54c2e0e266f4ab54fdd563873c2d95964b719a428545a8311155224f` |
| `com.atproto.label.defs.json` | `8ddce1a7ec654fe807ef354cffbd2e0ecc16c937b3f91b554604764be1b28c4b` |
| `com.atproto.repo.strongRef.json` | `66379e298b8ea897ef94524bdbf9abf7ae2bafcd97f0a82cb716139e350dee9e` |

`validateRecord` also accepts `app.bsky.actor.profile`. That record is not strict on write.

Consent text is English. `build.ts` sets `LANGUAGES` to `en`. French is (planned), with the i18n slice.

From the repository root:

```sh
node shared/lexicons/scripts/build.ts
node shared/lexicons/scripts/build.ts --check
node shared/lexicons/scripts/breaking-check.ts
```

`--check` exits 1 when `generated/` is stale. `breaking-check.ts` reads `published.lock.json`. With an empty lock it reports no problem. `--approved-by-alex=<PR number>` is the flag the permission-set addition path reads.

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

Who may import the index is the [shared](../) table. The domain row names `shared/lexicons/` specifically. On this tree `domains/` does not import it. Product importers are `infrastructure/pds/oauth/scopes.ts` and `infrastructure/pds/oauth/sign-in.ts`.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/lexicons/index.ts` |
| `validateRecord`, `NSID`, `LIMITS`, `IMAGE_ACCEPT`, `scopeString`, `scopeStringFallback` | re-exported from `index.ts` |
| Build | `shared/lexicons/scripts/build.ts`. Nothing outside `scripts/` imports it. |
| Breaking check | `shared/lexicons/scripts/breaking-check.ts`. Same rule. |

## Data

No Postgres schema, role or table. The record contract is the JSON under `schemas/` and `vendor/`. `published.lock.json` holds no NSID yet.
