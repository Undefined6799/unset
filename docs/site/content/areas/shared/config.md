---
title: config
weight: 1
---

Typed configuration, read once at boot. Package `@unset/shared-config`. Permanent values are [ADR 0025](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0025-public-domains.md). [ADR 0020](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0020-permanent-choices.md) is superseded by 0025.

## Owns

`shared/config/load.ts` reads the environment once. `bootOrExit` writes one JSON line per `ConfigError` problem (key and reason, no value) and exits 78. Any other failure exits 1. `exitOnConfigError` is the same exit for a check that runs after loading. `describeConfig` returns each key, its kind and whether it is set, and never a value.

`shared/config/schema.ts` is the field kinds: `str`, `int`, `bool`, `oneOf`, `url`, `origin`, `list`, `secret`, `secretFile`. A field parses one string. `withRule` carries a cross-key rule on the field, so a schema that merges the field merges the rule. `defineEntrypointConfig` starts from the common keys `UNSET_ENV`, `UNSET_SERVICE`, `UNSET_COMMIT` and `LISTEN_PORT`.

`shared/config/secret.ts`: a `Secret` prints, serialises and inspects as `[secret]`. The value leaves through `reveal()`. `equals` compares with `timingSafeEqual`.

`shared/config/netGuard.ts`: `netGuardFields` (`NETGUARD_INTERNAL_HOSTS`, `NETGUARD_ALLOW_LOOPBACK`) and `HOSTNAME`, the exact-hostname pattern a `str` field reuses. net-guard itself does not import this package. The composition root passes the parsed values.

`shared/config/permanent.ts` holds constants, not environment keys. `permanent.test.ts` pins them to the ADR 0025 rows.

| Constant | Value |
| --- | --- |
| `MATRIX_SERVER_NAME` | `unset.cc` |
| `PERMISSION_SET_NSID` | `sh.unset.authApp` |

`SERVICES` in `schema.ts` is the `UNSET_SERVICE` allowlist: `http`, `admin`, `api`, `indexer`, `media`, `review`, `jobs`, `audit-verify`, `chat-auth`.

| Name | Folder |
| --- | --- |
| `http` | `interfaces/http/` |

The other `SERVICES` names (`admin`, `api`, `indexer`, `media`, `review`, `jobs`, `audit-verify`, `chat-auth`) have no folder on this tree.

## May import

The non-leaf [`shared` row](../). This package's `package.json` has no `dependencies`. Source files import Node built-ins (`node:fs`, `node:util`, `node:crypto`).

Who may import it is the [shared](../) table. The domain row allows `shared/config/` as types only. On this tree `domains/` does not import it.

On this tree, product importers are `interfaces/http`, `infrastructure/{pds,postgres,seal}` and `shared/http`.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/config/index.ts` |
| `bootOrExit`, `loadConfig`, `describeConfig`, `exitOnConfigError`, `ConfigError` | `shared/config/load.ts` |
| `defineConfig`, `defineEntrypointConfig`, field kinds, `SERVICES` | `shared/config/schema.ts` |
| `Secret` | `shared/config/secret.ts` |
| `netGuardFields`, `HOSTNAME` | `shared/config/netGuard.ts` |
| `MATRIX_SERVER_NAME`, `PERMISSION_SET_NSID` | `shared/config/permanent.ts` |

Each interface loads through its own `config.ts` and calls `bootOrExit` from `main.ts`.

## Data

No schema, role or table. The values are the process environment and the two constants above. `shared/lexicons` repeats `sh.unset.authApp` because that package may not import this one. See [lexicons](../lexicons/).
