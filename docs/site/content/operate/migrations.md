---
title: Migrations
weight: 3
---

Schema changes applied by the one-shot Compose `migrate` service. File rules and the expand-then-contract order are in [migrations.md](https://github.com/Undefined6799/unset/blob/main/docs/human/db/migrations.md). The modules are on [postgres](../../areas/infrastructure/postgres/).

## Where the files are

`infrastructure/postgres/migrations/` holds `0001_init.sql` through `0015_app_account.sql`.

| Piece | Path |
| --- | --- |
| CLI | `infrastructure/postgres/migrate-cli.ts` (`unset-migrate`) |
| Package bin | `unset-migrate` → `./migrate-cli.ts` in `infrastructure/postgres/package.json` |
| Runner | `migrate` and `migrateThenSyncPasswords` in `infrastructure/postgres/migrate.ts` |
| Image entrypoint | `ENTRYPOINT ["node", "infrastructure/postgres/migrate-cli.ts"]` in `deployment/images/migrate.Dockerfile` |

The root `package.json` scripts are `check`, `typecheck`, `lint`, `format`, `guards`, `notes:index`, `test`, `test:images`, `budgets`, `semgrep:fixtures`, `dev:up`, `dev:down`, `dev:source:up`, `dev:source:down`, `local:up` and `local:down`. Starting the stack with `dev:up`, `dev:source:up` or `local:up` starts `migrate`.

## Compose service

`deployment/compose.dev.yaml`, `deployment/compose.dev.source.yaml` and `deployment/compose.local.yaml` name the service `migrate`. `compose.dev.yaml` sets `image` to the lock ref. The source file and local set `build` to `deployment/images/migrate.Dockerfile` with context `..`. The image and network rows are on [compose](../../areas/deployment/compose/).

Shared settings in all three files:

| Key | Value |
| --- | --- |
| `user` | `65532:65532` |
| `PG_HOST` | `postgres` |
| `PG_DATABASE` | `unset` |
| `PG_USER` | `migrator` |
| `PG_PASSWORD_FILE` | `/run/secrets/migrate_pg_password` |
| `PG_SSLMODE` | `disable` |
| `UNSET_ENV` | `dev` |
| `UNSET_COMMIT` | `0000000000000000000000000000000000000000` |
| `restart` | `no` |
| `depends_on.postgres` | `service_healthy` |
| `secrets` | `migrate_pg_password`, `pg_web_password`, `pg_api_password`, `pg_indexer_password` |

`web` in all three files has `depends_on.migrate` of `service_completed_successfully`.

## What one run does

`migrate-cli.ts` calls `bootOrExit(migrateConfig)`, then `migrateThenSyncPasswords` with `secretsDir` `ROLE_PASSWORDS_DIR` (`/run/secrets`). `migrateThenSyncPasswords` returns the migrate failure when `migrate` is not ok, and calls `syncRolePasswords` only when it is.

`migrateConfig` requires `UNSET_ENV` (`dev`, `test` or `prod`), `UNSET_COMMIT` (40 hex digits) and `postgresFields`. `bootOrExit` exits 78 on `ConfigError` (`EX_CONFIG` in `shared/config/load.ts`).

| Result | Exit |
| --- | --- |
| `migrate` ok and password sync ok | 0 |
| `migrate` failure | `failure.exit`: 1 error, 2 an applied file was edited, 3 a gap in the versions (`MigrateFailure` in `migrate.ts`) |
| password sync failure | 1 (`migrate-cli.ts` sets that when `step` is `passwords`) |

`MIGRATE_LOCK_ID` in `migrate.ts` is `0x756e7365`. The same file's `MigrateOptions` default for `lockWaitMs` is 60 seconds, and the default `retryDelaysMs` is 1, 2, 4, 8 and 16 seconds.
