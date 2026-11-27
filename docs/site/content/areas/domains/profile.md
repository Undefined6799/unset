---
title: profile
weight: 2
---

What a member may write on their page, checked once, and the `sh.unset.profile` record built from those fields. Package `@unset/domains-profile`. The module is [ADR 0037](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0037-profile-module-and-page.md), Accepted.

## Owns

Product rules in this folder. This folder does not open a socket.

| Module | What it holds |
| --- | --- |
| `domains/profile/index.ts` | Package root. Re-exports names from the other modules in this table, except `member-text.ts` and `web-address.ts`. |
| `domains/profile/profile.ts` | `parseProfileFields`, `readProfileRecord`, `toProfileRecord`, `PROFILE_FIELDS`, `EMPTY_PROFILE`. |
| `domains/profile/cards.ts` | Reading cards (ADR 0051): `parseCardKey`, `readCard`, `orderCards`, `pageCards` and the card view types. |
| `domains/profile/card-edit.ts` | Writing cards: `parseCardInput`, `toCardRecord`, `reorderCards`. |
| `domains/profile/web-address.ts` | `withScheme` and `isWebAddress`, shared by the website field and card addresses. Not a package export. |
| `domains/profile/page.ts` | The main `sh.unset.page` record at `self` (ADR 0091): `withCardListed`, `withCardUnlisted`, `withCardOrder`, `withVisibility`. `withList` sets the `cards` list and is not exported. |
| `domains/profile/visibility.ts` | `PageVisibility` is `public`, `signedIn` or `ownerOnly` (ADR 0078). `readPageVisibility` reads the page record: no `visibility` field is `public`; the other stored values are `signed-in` and `owner-only`; anything else is `ownerOnly`. `parsePageVisibility`, `pageShownTo`. |
| `domains/profile/member-text.ts` | `isPlainText` and `isPlainName`. `profile.ts` and `card-edit.ts` use them. Not a package export. |
| `domains/profile/crawlers.ts` | `robotsTxt`, `sitemapXml` and `CLOSED_ROBOTS_TXT` (ADR 0062). |
| `domains/profile/discoverability.ts` | `parseDiscoverabilityForm` (ADR 0062). `DISCOVERABILITY_OFF` has both switches off and empty title and description. `DISCOVERABILITY_LIMITS` is title 70 and description 200, in code points. |
| `domains/profile/index-plan.ts` | `fitsIndex` (imported by `page.ts`), `planCommit`, `fitsPage`, `recordBytes`. `MAX_RECORD_BYTES` is 1,000,000. `MAX_PAGE_BYTES` is 4 MiB. `fitsIndex` is not re-exported from `index.ts`. |

`PROFILE_FIELDS` is `displayName`, `headline`, `location`, `website`; links live on Links cards (ADR 0051). `EMPTY_PROFILE` sets each of them to `""`.

| Function | Result |
| --- | --- |
| `parseProfileFields` | The keys that were sent, after the checks below, or the first bad field. A key absent from the input is absent from the result. `null` and `undefined` become `""`. A non-string is `profile.invalid`. |
| `readProfileRecord` | `ProfileFields`. A value that is not a non-array object is `EMPTY_PROFILE`. Each field is checked on its own, and a bad one reads as `""`. |
| `toProfileRecord` | A record whose `$type` is `sh.unset.profile`, or a refusal. Sent fields replace what was stored. An empty string removes that key. Other keys on the stored object stay. `createdAt` stays when the stored value is a string, and otherwise is the `now` argument. |

| Code | When |
| --- | --- |
| `profile.invalid` | A non-string, a line break in a one-line field, or `validateRecord("sh.unset.profile", record, "read")` refuses the built record (`profile.ts`): a defined field is invalid. A stored field the lexicon does not define is kept, never refused (ADR 0038). |
| `profile.too_long` | Over a grapheme or byte bound. |
| `profile.url_invalid` | `website` or a link is not an `http` or `https` URL with a host and no user or password. |
| `profile.name_required` | The record to write has no display name. |

Edits are bounded by `APP_LIMITS` in `profile.ts`, never above the lexicon's `LIMITS.profile` (ADR 0051). A stored record is read against the lexicon's own limits, so a field another client wrote validly still shows. `displayName`, `headline` and `location` are counted in graphemes; `website` in bytes. A value with no scheme is prefixed with `https://` (`withScheme` in `web-address.ts`).

## Cards

A card is one `sh.unset.card` record holding one `sh.unset.block.*` block (ADR 0086). `readCard` validates the stored record in read mode and returns `null`, so the card is hidden, when it does not validate or its block is not a shown kind. The shown kinds are `readme`, `links`, `collection` and `buttons` (`KINDS` in `cards.ts`). An `image` block is not among them, so `readCard` returns `null` for it. `parseCardInput` still accepts `image`. A link, entry address or button that is not plain `http` or `https` (or an email button whose address does not look like one) is dropped, and the rest of the card still shows. An unknown width, layout or preset reads as the default: full, `list` for links, `carousel` for collections, `custom` for a link button. An absent or unknown `surface` reads as `filled`.

A list block (links, showcase, buttons) with no row left to show is hidden too; the editor never writes one.

`orderCards` keeps only the cards the `sh.unset.page` record's `cards` list names, in that list's order, skipping an entry with no card and showing a repeat once, at its first place (`cards.ts`, ADR 0091). A card the list does not name is not on the page (ADR 0086 point 3). `pageCards` reads the list off the page record. `withCardListed` adds a new card at the end of the list and `withCardUnlisted` takes a deleted one out; both keep every other stored entry as it is. `withCardOrder` writes the shown cards in their new order, then every entry the order does not name, unchanged. Those three write the page record (`page.ts`).

`parseCardInput` reads the editor's JSON (`kind`, optional `width`, optional `surface`, then the kind's fields). `surface` is `filled`, `outlined` or `plain`; any other set value is `card.invalid`. Omitting it leaves `surface` off the result. `toCardRecord` keeps a stored `surface` when that argument is omitted, and writing `filled` stores no `surface` field. It builds the record over the stored one: content is replaced, `createdAt` and fields this version does not know are kept, inside the content too while its kind is unchanged. `reorderCards` accepts only a list naming each existing card exactly once.

| Code | When |
| --- | --- |
| `card.kind_unknown` | `kind` is not `readme`, `links`, `collection`, `buttons` or `image`. |
| `card.required` | README text, a buttons heading, an entry title or a link address is empty, or a kept `image` has no stored picture. |
| `card.invalid` | A wrong type, an unknown width, surface, layout or preset, or a line break in a one-line field. |
| `card.too_long` | A list over the lexicon's count, or text past a lexicon limit. |
| `card.url_invalid` | An address is not `http` or `https` with a host and no user or password. |
| `card.email_invalid` | An email button's address does not look like one. |
| `card.order_invalid` | A reorder does not name each existing card exactly once. |

## May import

The [Domains](../) `domain` row, and the narrowing rules on that page.

`domains/profile/profile.ts` imports `LIMITS` and `validateRecord` from `@unset/shared-lexicons`. `domains/profile/package.json` declares that one dependency. The package export `.` of `@unset/shared-lexicons` is `shared/lexicons/index.ts`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `domains/profile/index.ts` |
| Form parse | `interfaces/web/src/routes/profile/save.server.ts` calls `parseProfileFields` |
| Record build | `interfaces/web/src/lib/server/profile-save.ts` `saveToPds` calls `toProfileRecord` and `saveProfileRecord` (`infrastructure/pds/profile-record.ts`). `routes/profile/+page.server.ts` calls `saveToPds`. |
| Read | `domains/profile/profile.test.ts` calls `readProfileRecord` |

There is no `main.ts`.

`index.ts` re-exports names from `profile.ts`, `cards.ts`, `card-edit.ts`, `page.ts`, `visibility.ts`, `crawlers.ts`, `discoverability.ts` and `index-plan.ts`. `member-text.ts` and `web-address.ts` are not package exports, and `fitsIndex` is not among the `index-plan.ts` names `index.ts` re-exports. Names from `profile.ts`:

| Names |
| --- |
| `EMPTY_PROFILE`, `PROFILE_FIELDS`, `parseProfileFields`, `readProfileRecord`, `toProfileRecord` |
| `ParsedProfile`, `ProfileEdit`, `ProfileError`, `ProfileField`, `ProfileFields`, `ProfileRecord` |

## Data

No schema, role, table or event type. Nothing in this folder writes Postgres. Where the record is kept is [ADR 0037](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0037-profile-module-and-page.md).
