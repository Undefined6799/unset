---
title: errors
weight: 2
---

The error-code catalog, and the only way a code goes into or comes out of a URL. Package `@unset/shared-errors`.

## Owns

`shared/errors/catalog.ts`: `ERROR_CODES`. Each code is `area.reason` in lowercase ASCII, with an HTTP status and a `public` flag. A non-public code is not written into a URL or a response body (`catalog.ts`). On this tree the only `public: false` code is `config.invalid`. `isErrorCode` accepts an own key only.

`shared/errors/AppError.ts`: `message` is the code. Free text does not travel on the error.

`shared/errors/redirect.ts`: `withErrorParam` sets `error=<code>` on a path. `readErrorParam` returns the code when it is a public catalog code, and `null` otherwise.

`shared/errors/messages.ts`: `ERROR_MESSAGES`, English text for each public code.

## May import

The non-leaf [`shared` row](../). This package's `package.json` has no `dependencies`. `catalog.ts`, `AppError.ts`, `redirect.ts` and `messages.ts` import only each other.

Who may import it is the [shared](../) table. The domain row names `shared/errors/` specifically. On this tree `domains/` does not import it.

On this tree, product importers include `apps/web`, `interfaces/http`, `infrastructure/{pds,postgres,session}`, `shared/http` and `shared/log`.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/errors/index.ts` |
| `ERROR_CODES`, `isErrorCode` | `shared/errors/catalog.ts` |
| `AppError` | `shared/errors/AppError.ts` |
| `withErrorParam`, `readErrorParam` | `shared/errors/redirect.ts` |
| `ERROR_MESSAGES` | `shared/errors/messages.ts` |

## Data

No schema, role or table. The catalog is the data. Codes are added in `catalog.ts` in the step that introduces them.
