---
title: Processes
weight: 1
---

Two Compose files exist. There is no production Compose file. `npm run dev:up` and `npm run local:up` (`package.json`) both run `node deployment/preflight/stack.ts`.

| Command | Compose file |
| --- | --- |
| `npm run dev:up` / `npm run dev:down` | `deployment/compose.dev.yaml` |
| `npm run local:up` / `npm run local:down` | `deployment/compose.local.yaml` |

Secrets and the interpolation env stay outside the checkout. The dev file points at `../../unset-dev-secrets/` and `../../unset-dev-env/`. The procedure is [`docs/human/runbooks/dev-stack-secrets.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/dev-stack-secrets.md).

## Dev services

`deployment/compose.dev.test.ts` (`compose_dev_hardening`) requires every service in both files to drop `ALL` capabilities, set `no-new-privileges`, use a read-only root and a numeric non-root user, and mount `/tmp` on tmpfs. Only `edge` adds `NET_BIND_SERVICE`.

| Service | Build or image | User | Networks | What it runs |
| --- | --- | --- | --- | --- |
| `postgres` | `deployment/images/postgres.Dockerfile` | `999:999` | `db` | Postgres. Data volume `pgdata`. |
| `migrate` | `deployment/images/migrate.Dockerfile` | `65532:65532` | `db` | One shot (`restart: "no"`), role `migrator`, then exits. |
| `pds` | `ghcr.io/bluesky-social/pds:0.4.5037`, digest-pinned in the file | `1000:1000` | `edge`, `pds_egress` | Bluesky's PDS image, port 3000 inside the network. |
| `edge` | `deployment/edge/Dockerfile` | `65532:65532` | `edge`, `app`, `newt_edge` at `10.250.37.3` | Caddy. Dev publishes no host port. |
| `web` | `deployment/images/node-app.Dockerfile` | `65532:65532` | `db`, `app`, `web_egress` | `UNSET_SERVICE=http`, listen `8080`, Postgres role `web`. |
| `newt` | `docker.io/fosrl/newt:1.18.1`, digest-pinned in the file | `65532:65532` | `newt_egress`, `newt_edge` at `10.250.37.2` | Pangolin connector. Dev only. |

Both files set `PDS_RATE_LIMITS_ENABLED` and `LOG_ENABLED` to `"false"` on `pds`. `PDS_DID_PLC_URL` and web's `PLC_URL` are `https://plc.directory`.

## Local differences

| | Dev | Local |
| --- | --- | --- |
| Host ports | none | `edge` publishes `127.0.0.1:80` and `127.0.0.1:443` |
| `newt` | running | absent |
| Edge aliases | none on the service | `${APP_HOST}` and `${PDS_HOSTNAME}` on `edge` and `app` |
| `NETGUARD_INTERNAL_HOSTS` | unset on `web` | `${PDS_HOSTNAME}` |
| `pds-token-reader` | absent | profile `tools`, `network_mode: none`, not started by `up` |

`shared/config/netGuard.ts` defaults `NETGUARD_INTERNAL_HOSTS` to an empty list. Prod config refuses that empty list; dev and local do not.

## Networks

`deployment/networks.dev.json` is the dev membership table. `deployment/compose.dev.test.ts` (`compose_dev_networks_match_table`) fails when the Compose file drifts from it.

| Network | Internal | Members |
| --- | --- | --- |
| `db` | yes | `postgres`, `migrate`, `web` |
| `app` | yes | `edge`, `web` |
| `edge` | no | `pds`, `edge` |
| `pds_egress` | no | `pds` |
| `web_egress` | no | `web` |
| `newt_edge` | yes, `10.250.37.0/29` | `newt`, `edge` |
| `newt_egress` | no | `newt` |

`web` and `pds` share no network. Local has `db`, `app`, `edge`, `pds_egress` and `web_egress`, and no Newt networks.

## Database roles

`deployment/postgres/init/00-bootstrap.sh` runs once at initdb. It creates login roles `migrator` and `tap`, databases `unset` (owner `migrator`) and `tap` (owner `tap`), and revokes `PUBLIC`. Neither Compose file has a tap service.

`infrastructure/postgres/migrations/0003_roles_and_grants.sql` creates the roster in `infrastructure/postgres/roles.json` with no passwords. `infrastructure/postgres/roles.ts` (`syncRolePasswords`) sets a password only where `passwordFrom` is a file name. The migrate service mounts `pg_web_password`, `pg_api_password` and `pg_indexer_password`.

| Role | Class | Login | Connections | `statement_timeout` | Password file |
| --- | --- | --- | --- | --- | --- |
| `web` | service | yes | 40 | 2s | `pg_web_password` |
| `api` | service | yes | 20 | 2s | `pg_api_password` |
| `indexer` | service | yes | 10 | 10s | `pg_indexer_password` |
| `admin` | service | yes | 10 | 5s | none |
| `retention` | job | yes | 2 | 60s | none |
| `media` | service | yes | 10 | 2s | none |
| `review` | service | yes | 4 | 10s | none |
| `review_egress` | service | yes | 2 | 5s | none |
| `auditor` | job | yes | 2 | 60s | none |
| `backup` | job | yes | 2 | 0 | none |
| `legal_hold_reader` | group | no | -1 | none | none |
| `audit_owner` | owner | no | -1 | none | none |

Every roster role gets `idle_in_transaction_session_timeout` 10s, `lock_timeout` 3s and an empty `search_path` (migration `0003`). `legal_hold_reader` and `audit_owner` have `connectionLimit: null` in `roles.json`; the migration sets `CONNECTION LIMIT -1` and no `statement_timeout`. Column grants are `infrastructure/postgres/grant-matrix.json`. In the dev stack, `web` connects as `web` and `migrate` connects as `migrator`.

## Interface processes outside Compose

These folders have a `main.ts` and a routes manifest whose only route is `GET /health`. They are not services in either Compose file. The app image refuses any `APP` other than `web` and its entrypoint is `node interfaces/http/main.ts`.

| Folder | Manifest |
| --- | --- |
| `interfaces/admin` | `interfaces/admin/routes.manifest.json` |
| `interfaces/api` | `interfaces/api/routes.manifest.json` |
| `interfaces/indexer` | `interfaces/indexer/routes.manifest.json` |
| `interfaces/media` | `interfaces/media/routes.manifest.json` |
| `interfaces/review` | `interfaces/review/routes.manifest.json` |

`interfaces/pds-admin` and `interfaces/chat-admin` are **(planned)**. Chat admin is Phase 6 in [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md) §8. A minimal `pds-admin` is Phase 2 in that section. `apps/admin` and `apps/chat` are **(planned)**; chat is Phase 6.
