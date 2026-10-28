---
title: Processes
weight: 1
---

Containers in the dev stack (`deployment/compose.dev.yaml`), the database roles (`infrastructure/postgres/roles.json`), and the networks (`deployment/networks.dev.json`, same membership as the compose file).

Every service drops all capabilities, sets `no-new-privileges`, uses a read-only root and its image's non-root user, and has memory, CPU and process limits. The edge adds `NET_BIND_SERVICE`. Secret files live outside the checkout; the compose `secrets:` block names them. [`docs/human/runbooks/dev-stack-secrets.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/dev-stack-secrets.md) is the runbook.

## Dev stack

`web` is the `http` process (`UNSET_SERVICE=http`, `interfaces/http`). No other interface is a service in this file.

| Service | Image | User | Networks | Database role |
| --- | --- | --- | --- | --- |
| postgres | `deployment/images/postgres.Dockerfile` | 999:999 | db | bootstrap superuser; init creates `migrator` and `tap` |
| migrate | `deployment/images/migrate.Dockerfile` | 65532:65532 | db | `migrator` on database `unset`; `restart: "no"` |
| pds | `ghcr.io/undefined6799/unset/pds` (digest-pinned): the official `0.4.5037` image with its OAuth UI dist replaced (P2.24y) | 1000:1000 | edge, pds_egress | its own volume, not our Postgres |
| edge | `deployment/edge` | 65532:65532 | edge, app, newt_edge `10.250.37.3` | none |
| web | `deployment/images/node-app.Dockerfile` | 65532:65532 | db, app, web_egress | `web` |
| newt | `docker.io/fosrl/newt:1.19.0` (digest-pinned) | 65532:65532 | newt_egress, newt_edge `10.250.37.2` | none |

Newt is Pangolin's connector ([ADR 0030](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0030-pangolin-checks-at-our-edge.md)). Under dev the edge publishes no port. `PLC_URL` on web is `https://plc.directory` ([ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md), decided (0001 log), acceptance pending).

`deployment/compose.local.yaml` is the throwaway stack on one machine. `deployment/compose.local.test.ts` holds it to the dev file. Differences that change this picture: no Newt; the edge publishes `127.0.0.1:80` and `127.0.0.1:443`; web sets `NETGUARD_INTERNAL_HOSTS` from `PDS_HOSTNAME`; `pds-token-reader` is a `tools` profile service and `up` does not start it. The file header lists the rest.

## Internal hosts

`NETGUARD_INTERNAL_HOSTS` names hosts inside the stack that must resolve only to private addresses (`shared/config/netGuard.ts`). [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) Decision 3 names our PDS as that one entry (decided (0001 log), acceptance pending). [ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md) Decision 3 drops the exception on staging: web reaches the PDS through public DNS, Pangolin, Newt and the edge. The two do not conflict. 0022 is the egress rule. 0031 is the accepted staging path, and local still sets the one entry.

| Environment | `NETGUARD_INTERNAL_HOSTS` |
| --- | --- |
| local | Set to our PDS (`deployment/compose.local.yaml`, `${PDS_HOSTNAME}`) |
| dev/staging | Must be absent. `devTunnelProblems` (`deployment/preflight/checks/networks.ts`) fails a service that names one. The dev compose file does not set the key. ADR 0031 Decision 3 drops the exception. |
| prod | Required and non-empty. The field rule fails when `UNSET_ENV` is `prod` and the list is empty (`shared/config/netGuard.ts`). |

## Networks

| Network | Internal | Members | Use |
| --- | --- | --- | --- |
| db | yes | postgres, migrate, web | Postgres |
| app | yes | edge, web | edge to web:8080 |
| edge | no | pds, edge | the only network shared with the PDS HTTP port |
| pds_egress | no | pds | the PDS's way out |
| web_egress | no | web | web's way out |
| newt_edge | yes, `10.250.37.0/29` | newt `.2`, edge `.3` | Newt to the edge |
| newt_egress | no | newt | Newt's tunnel to Pangolin |

`web` and the PDS share no network. Under dev the edge has no network aliases (`deployment/compose.dev.test.ts`, `no_service_answers_for_the_app_or_pds_host`). [ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md) Decision 3: web resolves the staging PDS through public DNS to Pangolin, then Newt and the edge.

## Database roles

`deployment/postgres/init/00-bootstrap.sh` runs at initdb and creates `migrator` (login, owns database `unset`) and `tap` (login, owns database `tap`). Those two are not in `roles.json`. `deployment/compose.local.yaml` mounts `./postgres/init` on postgres and nothing else there, the same init directory `deployment/compose.dev.yaml` and `deployment/compose.dev.source.yaml` mount. The phase-1 book still describes a local read-only `init-local/` mount (`docs/ai/book/phase-1.md`, the P1.34d difference list and P1.34u). That passage is superseded by [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) and [ADR 0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md) (no PLC of our own; both decided (0001 log), acceptance pending). `deployment/postgres/init-local/10-local-plc.sh` still creates a `plc` role. None of the three compose files mounts it.

Migration `infrastructure/postgres/migrations/0003_roles_and_grants.sql` creates every `roles.json` role with no table privileges. `infrastructure/postgres/roles.ts` sets a password only when `passwordFrom` is a file name. A login role with `passwordFrom: null` gets no password from that sync.

| Role | Class | Login | Connections | `statement_timeout` | Password file |
| --- | --- | --- | --- | --- | --- |
| web | service | yes | 40 | 2s | `pg_web_password` |
| api | service | yes | 20 | 2s | `pg_api_password` |
| indexer | service | yes | 10 | 10s | `pg_indexer_password` |
| admin | service | yes | 10 | 5s | none |
| retention | job | yes | 2 | 60s | none |
| media | service | yes | 10 | 2s | none |
| review | service | yes | 4 | 10s | none |
| review_egress | service | yes | 2 | 5s | none |
| auditor | job | yes | 2 | 60s | none |
| backup | job | yes | 2 | 0 | none |
| legal_hold_reader | group | no | — | none | none |
| audit_owner | owner | no | — | none | none |

Every roster role gets `idle_in_transaction_session_timeout=10s`, `lock_timeout=3s` and an empty `search_path` (migration 0003). `web` is the only roster role with a running service in the dev stack. `api` and `indexer` have password files mounted on `migrate` for the sync; their processes are not in the compose file.

## Interface processes not in Compose

These folders start a server. `compose.ts` passes an empty route list, so the kit serves `GET /health` and nothing else (`shared/http/server.ts` adds that route).

| Folder | Entry | Routes today |
| --- | --- | --- |
| `interfaces/admin` | `main.ts` | `GET /health` |
| `interfaces/api` | `main.ts` | `GET /health` |
| `interfaces/indexer` | `main.ts` | `GET /health` |
| `interfaces/media` | `main.ts` | `GET /health` |
| `interfaces/review` | `main.ts` | `GET /health` |
