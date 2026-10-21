---
title: Postgres init
weight: 4
---

Scripts the Postgres image runs once, at initdb, as the bootstrap superuser. Later roles come from migrations. The role roster is `infrastructure/postgres/roles.json`, on the infrastructure area's postgres page when that page is on main.

## Owns

| File | Mount | What it runs |
| --- | --- | --- |
| `deployment/postgres/init/00-bootstrap.sh` | both compose files, `./postgres/init` → `/docker-entrypoint-initdb.d`, read-only | Creates `migrator` (`LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS`) and `tap` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`). Creates databases `unset` (owner `migrator`) and `tap` (owner `tap`). `REVOKE ALL` on both databases and on `unset`'s `public` schema from `PUBLIC`. `CREATE EXTENSION pgcrypto` in `unset`. Sets `password_encryption` to `scram-sha-256` before the passwords. |
| `deployment/postgres/init-local/10-local-plc.sh` | not mounted by either compose file | Creates role `plc` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`) and database `plc`. Revokes `PUBLIC` on that database, on `postgres` and `template1` (`CONNECT`, `TEMPORARY`), and on `plc`'s `public` schema. |

`00-bootstrap.sh` reads `/run/secrets/pg_migrator_password` and `/run/secrets/pg_tap_password` inside `psql` (`\set` and `:'name'`). A missing or empty file exits 1 before any statement. `10-local-plc.sh` does the same for `pg_plc_password`.

The script header of `10-local-plc.sh` says `compose.local.yaml` mounts this folder beside the bootstrap, and that dev and prod never mount it. On this tree both compose files mount only `./postgres/init`. `deployment/preflight/local-only.ts` says [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) retired the local PLC. That ADR's status line is Proposed. Its decision 1 says we run no PLC.

CODEOWNERS lists both directories in the trusted-base section.

## May import

Shell, not modules. No `MATRIX` row. The [deployment](../) preflight row does not reach these files.

## Entry points

The official Postgres image runs executable `*.sh` in `/docker-entrypoint-initdb.d` in sorted order, once, at initdb. The mount is the `postgres` service in `deployment/compose.dev.yaml` and `deployment/compose.local.yaml`. The image is [images](../images/) `postgres.Dockerfile`, which does not replace the upstream entrypoint.

There is no CLI in this folder.

## Data

No migration and no `roles.json` row live here. The two scripts create the roles and databases named above. Passwords are the Compose file secrets `pg_migrator_password`, `pg_tap_password` and, for the unmounted script, `pg_plc_password`. The secret files are outside the checkout. See [compose](../compose/).
