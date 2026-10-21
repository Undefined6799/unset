---
title: Postgres init
weight: 4
---

Scripts the Postgres image runs once, at initdb, as the bootstrap superuser. Later roles come from migrations. The role roster is `infrastructure/postgres/roles.json`, on the infrastructure area's postgres page when that page is on main.

## Owns

| File | Mount | What it runs |
| --- | --- | --- |
| `deployment/postgres/init/00-bootstrap.sh` | both compose files, `./postgres/init` → `/docker-entrypoint-initdb.d`, read-only | Creates `migrator` (`LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS`) and `tap` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`). Creates databases `unset` (owner `migrator`) and `tap` (owner `tap`). `REVOKE ALL` on both databases and on `unset`'s `public` schema from `PUBLIC`. `CREATE EXTENSION pgcrypto` in `unset`. Sets `password_encryption` to `scram-sha-256` before the passwords. |

`00-bootstrap.sh` reads `/run/secrets/pg_migrator_password` and `/run/secrets/pg_tap_password` inside `psql` (`\set` and `:'name'`). A missing or empty file exits 1 before any statement.

| Path | Status |
| --- | --- |
| `deployment/postgres/init-local/10-local-plc.sh` | On the tree. Superseded by [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) and [ADR 0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md). Neither compose file mounts it. |

The header of `10-local-plc.sh` says `compose.local.yaml` mounts that folder. Both compose files mount only `./postgres/init`. CODEOWNERS lists `/deployment/postgres/init/` and `/deployment/postgres/init-local/` in the trusted-base section.

## May import

Shell, not modules. No `MATRIX` row. The [deployment](../) preflight row does not reach these files.

## Entry points

The official Postgres image runs executable `*.sh` in `/docker-entrypoint-initdb.d` in sorted order, once, at initdb. The mount is the `postgres` service in `deployment/compose.dev.yaml` and `deployment/compose.local.yaml`. The image is [images](../images/) `postgres.Dockerfile`, which does not replace the upstream entrypoint.

There is no CLI in this folder. `deployment/postgres/init-local/` is not an entry point: the compose files do not mount it.

## Data

No migration and no `roles.json` row live here. `00-bootstrap.sh` creates the roles and databases named above. Passwords are the Compose file secrets `pg_migrator_password` and `pg_tap_password`. The secret files are outside the checkout. See [compose](../compose/).
