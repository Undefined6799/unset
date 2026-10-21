---
title: postgres
weight: 4
---

The database adapter. Package `@unset/infrastructure-postgres`. Driver choice is [ADR 0014](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0014-node-postgres.md). `pg` in this package's `package.json` is 8.23.1.

## Owns

Migrations, the role roster, grants, pools, transactions, and the stores whose SQL lives here.

| Module | What it holds |
| --- | --- |
| `infrastructure/postgres/migrate.ts` | `migrate`, `migrateThenSyncPasswords`. Applies `migrations/*.sql` in order as the connected role, under advisory lock `MIGRATE_LOCK_ID`. Checksums live in `public.schema_migrations`, created by the runner, not by a migration file. |
| `infrastructure/postgres/migrate-cli.ts` | `unset-migrate`. `ROLE_PASSWORDS_DIR` is `/run/secrets`. |
| `infrastructure/postgres/sqlLint.ts` | Text lint of a migration before it runs. An expand file is refused when its text matches `drop`, `rename`, `alter_type`, `set_not_null` or `truncate`. |
| `infrastructure/postgres/roles.json` | The roster below. |
| `infrastructure/postgres/roles.ts` | `syncRolePasswords`. Skips a row whose `passwordFrom` is null. `ALTER ROLE` gets the string `scramVerifier` returns. |
| `infrastructure/postgres/grant-matrix.json` | Grants the integration test diffs. |
| `infrastructure/postgres/pool.ts` | `createPool`, `acquire`, `withClient`, `checkConnectionBudget`. The file comment and [ADR 0014](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0014-node-postgres.md) say `pool.connect` and `pool.query` live only here. `migrate.ts` and `roles.ts` open a `pg.Client` and call `client.connect()`. |
| `infrastructure/postgres/tx.ts` | `inTransaction`, `withTransaction`. The file comment says `BEGIN`, `COMMIT` and `ROLLBACK` in TypeScript live only here. `docs/human/architecture.md` row DM-2 names Semgrep `transactions-only-in-tx`. |
| `infrastructure/postgres/config.ts` | `postgresFields`, `poolFields`, `lockPoolFields`, `connectionOf`. |
| `infrastructure/postgres/lock.ts` | `withAdvisoryLock`, `createRequestLock`. `LockNamespace.oauth` is `1`. The wait calls `pg_advisory_xact_lock`. |
| `infrastructure/postgres/oauthStores.ts` | `createOAuthStateStore`, `createOAuthSessionStore`. SQL on `app.oauth_state` and `app.oauth_session`. Values go through the sealer. |
| `infrastructure/postgres/singleUse/store.ts` | `createSingleUseStore`. SQL on `app.single_use`. `PURPOSES` is the closed list. |
| `infrastructure/postgres/didColumns.ts` | `didColumns`. One catalog query for columns typed `types.did` or `types.at_uri`, including arrays. |
| `infrastructure/postgres/sealedColumns.ts` | `sealedColumns`, `sealedContext`. Rows from `sealed-columns.json`. |
| `infrastructure/postgres/rewrapAll.ts` | `rewrapAll`, `kidCounts`. |
| `infrastructure/postgres/rewrap-cli.ts` | `unset-rewrap`. |
| `infrastructure/postgres/erasure-registry.json` | DID columns and an erasure strategy per column. |

`createPool` sets `application_name` from its `service` argument and `connectionTimeoutMillis` from `connectTimeoutMs`. `connectionOf` maps `PG_SSLMODE=disable` to `ssl: false` and `verify-full` to `ssl: true` or `{ ca }`. The `disable` rule calls `classifyAddress` from `@unset/infrastructure-net-guard`.

`tests/integration/postgres/grants.test.ts` reads `roles.json` and `grant-matrix.json` and diffs them with a database migrated from scratch. `tests/integration/postgres/did-columns.test.ts` and `sealed-columns.test.ts` cover the two registries.

## May import

The [`infrastructure` row](../). This package imports `net-guard` and `seal`.

Declared in `infrastructure/postgres/package.json`:

| Dependency | Version |
| --- | --- |
| `@unset/infrastructure-net-guard` | workspace |
| `@unset/infrastructure-seal` | workspace |
| `@unset/shared-config` | workspace |
| `@unset/shared-errors` | workspace |
| `@unset/shared-log` | workspace |
| `pg` | 8.23.1 |

`vendor-sdk-one-adapter` confines `pg` to this folder. Dev dependency `@types/pg` is 8.23.1.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/postgres/index.ts` |
| Bin `unset-migrate` | `infrastructure/postgres/migrate-cli.ts` |
| Bin `unset-rewrap` | `infrastructure/postgres/rewrap-cli.ts` |
| Image | `ENTRYPOINT ["node", "infrastructure/postgres/migrate-cli.ts"]` in `deployment/images/migrate.Dockerfile` |
| Compose | Service `migrate` in `deployment/compose.dev.yaml` and `deployment/compose.local.yaml`. `PG_USER` is `migrator`. |
| Pools | `interfaces/http/compose.ts` calls `createPool` and `createLockPool` |

The Postgres server is Compose service `postgres`, image `deployment/images/postgres.Dockerfile` (`FROM docker.io/library/postgres:18-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336`). `deployment/postgres/init/00-bootstrap.sh` runs at initdb and creates roles `migrator` and `tap`, databases `unset` and `tap`. `tap` is not in `roles.json`. There is no `infrastructure/tap/` folder **(planned)**.

`unset-rewrap` is a bin in `package.json`. No Dockerfile `ENTRYPOINT` names `rewrap-cli.ts`.

## Data

`0002_schemas.sql` creates schemas `app`, `idx`, `audit` and `types`. `grant-matrix.json` owners: `app`, `idx` and `types` are `migrator`; `audit` is `audit_owner`. `0003_roles_and_grants.sql` runs `ALTER SCHEMA audit OWNER TO audit_owner` and `GRANT audit_owner TO migrator WITH SET TRUE, INHERIT FALSE`.

Roster in `roles.json`. `statement_timeout` is the `settings` value; two rows omit it.

| Role | Class | Login | `connectionLimit` | `statement_timeout` | `passwordFrom` |
| --- | --- | --- | --- | --- | --- |
| `web` | service | yes | 40 | `2s` | `pg_web_password` |
| `api` | service | yes | 20 | `2s` | `pg_api_password` |
| `indexer` | service | yes | 10 | `10s` | `pg_indexer_password` |
| `admin` | service | yes | 10 | `5s` | null |
| `retention` | job | yes | 2 | `60s` | null |
| `media` | service | yes | 10 | `2s` | null |
| `review` | service | yes | 4 | `10s` | null |
| `review_egress` | service | yes | 2 | `5s` | null |
| `auditor` | job | yes | 2 | `60s` | null |
| `backup` | job | yes | 2 | `0` | null |
| `legal_hold_reader` | group | no | null | absent | null |
| `audit_owner` | owner | no | null | absent | null |

`0003_roles_and_grants.sql` creates those twelve roles when missing. It sets `search_path` to empty, `idle_in_transaction_session_timeout` `10s` and `lock_timeout` `3s` on each. `migrator` is not in the file.

Schema `USAGE` in `grant-matrix.json`:

| Schema | Roles |
| --- | --- |
| `app` | `web`, `admin`, `retention` |
| `audit` | `web`, `indexer`, `admin`, `retention`, `auditor` |
| `idx` | `web`, `api`, `indexer`, `admin` |
| `types` | `web`, `api`, `indexer`, `admin`, `audit_owner` |

`idx` has no table in `migrations/`. `grant-matrix.json` gives `media`, `review`, `review_egress` and `backup` database `CONNECT` and no schema or table privilege. `legal_hold_reader` and `audit_owner` have an empty database list there, and no table privilege. `audit_owner` is the `audit` schema owner in that file. `0003_roles_and_grants.sql` grants `CONNECT` to `web`, `api`, `indexer`, `admin`, `retention`, `media`, `review`, `review_egress`, `auditor` and `backup`.

Table and routine grants in `grant-matrix.json` (column lists are in that file):

| Object | Roles |
| --- | --- |
| `app.single_use` | `web` (column list); `retention` (`SELECT` on `expires_at`, `DELETE`) |
| `app.session` | `web` |
| `app.end_sessions_for_did` | `web` (`EXECUTE`) |
| `app.oauth_state` | `web` |
| `app.oauth_session` | `web` |
| `app.account` | `web` |
| `audit.append` | `web`, `indexer`, `admin` (`EXECUTE`) |
| `audit.chain` | `auditor` (`SELECT`, `wholeTable`) |

Migrations and the objects they add:

| File | Objects |
| --- | --- |
| `0001_init.sql` | No statement. The runner records version 1. |
| `0002_schemas.sql` | Schemas `app`, `idx`, `audit`, `types`. |
| `0003_roles_and_grants.sql` | The twelve roles, `CONNECT`, schema `USAGE`, `audit` owner. |
| `0004_types.sql` | Domains `types.did` and `types.at_uri`. Function `types.at_uri_did`. |
| `0005_retention_app_usage.sql` | `USAGE` on `app` for `retention`. |
| `0006_single_use.sql` | `app.single_use`. |
| `0007_sealed_type.sql` | Domain `types.sealed`. Check `^s1\.[a-z0-9]{1,16}\.`. |
| `0008_audit.sql` | `audit.lp`, `audit.row_hash`, `audit.append`, `audit.refuse_change`. |
| `0009_audit_tables.sql` | `audit.retention_classes`, `audit.actions`, `audit.reasons`, `audit.chain`, `audit.event_body`. |
| `0010_audit_append_grant.sql` | `EXECUTE` on `audit.append` for `web`, `indexer`, `admin`. |
| `0011_app_session.sql` | `app.session`. The comment names `infrastructure/postgres/session/`. The store is `infrastructure/session/store.ts`. `migrate.ts` checksums an applied file, so the comment stays. |
| `0012_app_session_did_index.sql` | Index `session_did`. Marked `-- unset: no-transaction`. |
| `0013_app_oauth.sql` | `app.oauth_state`, `app.oauth_session`. |
| `0014_app_end_sessions.sql` | `app.end_sessions_for_did` (`SECURITY DEFINER`). |
| `0015_app_account.sql` | `app.account`. |

`sealed-columns.json`: `app.oauth_session.sealed` row key `did`; `app.oauth_state.sealed` row key `key`.

`erasure-registry.json`: `app.single_use.bind_did`, `app.session.did`, `app.oauth_session.did` and `app.account.did` (`delete_row`); `audit.event_body.subject` (`audit_redact`).

`singleUse/store.ts` `PURPOSES`: `login.nonce` 600, `module.assertion` 120, `service_auth.jti` 120, `invite.claim` 600, `email.interstitial` 600, `chat.openid` 3600. The numbers are seconds.
