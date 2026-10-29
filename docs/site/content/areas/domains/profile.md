---
title: profile
weight: 2
---

What a member may write on their page, checked once, and the `sh.unset.profile` record built from those fields. Package `@unset/domains-profile`. The module is [ADR 0037](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0037-profile-module-and-page.md), Accepted.

## Owns

Product rules for those fields. This folder does not open a socket.

| Module | What it holds |
| --- | --- |
| `domains/profile/index.ts` | Package root. Re-exports the names below. |
| `domains/profile/profile.ts` | `parseProfileFields`, `readProfileRecord`, `toProfileRecord`, `PROFILE_FIELDS`, `EMPTY_PROFILE`. |

`PROFILE_FIELDS` is `displayName`, `headline`, `location`, `website`, `links`. `EMPTY_PROFILE` sets each of them to `""`.

| Function | Result |
| --- | --- |
| `parseProfileFields` | The keys that were sent, after the checks below, or the first bad field. A key absent from the input is absent from the result. `null` and `undefined` become `""`. A non-string is `profile.invalid`. |
| `readProfileRecord` | `ProfileFields`. A value that is not a non-array object is `EMPTY_PROFILE`. Each field is checked on its own, and a bad one reads as `""`. |
| `toProfileRecord` | A record whose `$type` is `sh.unset.profile`, or a refusal. Sent fields replace what was stored. An empty string removes that key. Other keys on the stored object stay. `createdAt` stays when the stored value is a string, and otherwise is the `now` argument. `updatedAt` is `now`. |

| Code | When |
| --- | --- |
| `profile.invalid` | A non-string, a line break in a one-line field, or `validateRecord("sh.unset.profile", record, "read")` refuses the built record (`profile.ts`): a defined field is invalid. A stored field the lexicon does not define is kept, never refused (ADR 0038). |
| `profile.too_long` | Over a grapheme or byte bound, or more links than `LIMITS.profile.linksMax`. |
| `profile.url_invalid` | `website` or a link is not an `http` or `https` URL with a host and no user or password. |
| `profile.name_required` | The record to write has no display name. |

Bounds are `LIMITS.profile` in `shared/lexicons/src/limits.ts`. `displayName`, `headline` and `location` are counted in graphemes. `website` and each link are counted in bytes. A value with no scheme is prefixed with `https://` (`withScheme` in `profile.ts`). `links` is one URL a line, blank lines dropped, and the record stores them as `{ uri }` objects.

## May import

The [Domains](../) `domain` row, and the narrowing rules on that page.

`domains/profile/profile.ts` imports `LIMITS` and `validateRecord` from `@unset/shared-lexicons`. `domains/profile/package.json` declares that one dependency. The package export `.` of `@unset/shared-lexicons` is `shared/lexicons/index.ts`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `domains/profile/index.ts` |
| Form parse | `interfaces/http/routes/profile.ts` imports `parseProfileFields` and `PROFILE_FIELDS` |
| Record build | `interfaces/http/compose.ts` passes `(existing) => toProfileRecord(fields, existing, now)` to `saveProfileRecord` in `infrastructure/pds/profile-record.ts` |
| Read | `domains/profile/profile.test.ts` calls `readProfileRecord` |

There is no `main.ts`.

Re-exports from `index.ts`, all from `profile.ts`:

| Names |
| --- |
| `EMPTY_PROFILE`, `PROFILE_FIELDS`, `parseProfileFields`, `readProfileRecord`, `toProfileRecord` |
| `ParsedProfile`, `ProfileEdit`, `ProfileError`, `ProfileField`, `ProfileFields`, `ProfileRecord` |

## Data

No schema, role, table or event type. Nothing in this folder writes Postgres. Where the record is kept is [ADR 0037](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0037-profile-module-and-page.md).
