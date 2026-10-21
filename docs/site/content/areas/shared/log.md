---
title: log
weight: 7
---

Structured logging for every process. Package `@unset/shared-log`. One JSON line per call.

## Owns

`shared/log/logger.ts`: `createLogger`. A line carries `ts`, `level`, `svc`, `commit` and `event`. `level` is `info`, `warn` or `error`.

An event name not in the `EVENTS` array is written as `log.unknown_event` with `kind` set to `[event]`. The names live in that array. A later step adds the events it logs.

`cleanFields` keeps a field only when its name is in `ALLOWED` and the value is a string, number, boolean or `null`. Anything else increments `dropped` and is left out. `version` must be a non-negative safe integer.

| Allowed field |
| --- |
| `code`, `route`, `method`, `status`, `ms`, `reqId`, `count`, `bytes` |
| `key`, `reason`, `phase`, `kind`, `job`, `attempt`, `version`, `sqlstate`, `island` |

`route` is kept when it is a route template, otherwise `[route]`. `reqId` and `sqlstate` are kept when they match their patterns, otherwise a placeholder. `reason`, `phase`, `job`, `kind`, `key` and `island` are kept when they match `WORD_FIELDS`. Other strings go through `scrub`.

`shared/log/scrub.ts`: `scrub` replaces control characters with `?`, redacts each shape in `SENSITIVE` to `[redacted]`, and truncates to 200 code points. The shapes in that array are a JWT, an HTTP `Bearer` or `Basic` credential, an email address, a DID, a multibase key, an IPv4 address, an IPv6 address, and a long token-like run.

`logError` writes the code and the error's class name. Stack frames (`file:line`) are included only when `env` is not `prod`.

A failed write is dropped. Logging does not exit the process (`write` in `createLogger`).

## May import

The non-leaf [`shared` row](../). Declared in `shared/log/package.json`:

| Dependency | Version |
| --- | --- |
| `@unset/shared-errors` | workspace |

`logger.ts` imports `AppError` and `ErrorCode` from that package, and `scrub` from `./scrub.ts`.

Who may import it is the [shared](../) table. On this tree, product importers include `interfaces/{admin,api,http,indexer,media,review}`, `infrastructure/{pds,postgres,session}` and `shared/http`.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/log/index.ts` |
| `createLogger` | `shared/log/logger.ts` |
| `scrub` | `shared/log/scrub.ts` |

Each interface calls `createLogger` from its `compose.ts` and passes the logger to `createServer`.

## Data

No schema, role or table. Lines go to stdout. The allowlist above is the data that may appear in a line.
