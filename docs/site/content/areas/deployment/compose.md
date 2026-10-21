---
title: Compose
weight: 1
---

The two stacks the wrapper starts. Dev is the homelab file. Local is the throwaway file on one machine. There is no `compose.prod.yaml` on the tree.

## Owns

`deployment/compose.dev.yaml` (`name: unset-dev`) and `deployment/compose.local.yaml` (`name: unset-local`). Both are read by the preflight's parser (`deployment/preflight/compose-parse.ts`), not by `docker compose config`. The file headers state the subset that parser accepts: no interpolation outside `environment` (local also allows it in network aliases), no `healthcheck`, no `command`.

Dev runs each service's `deployment/images.lock.json` ref, by digest, and has no `build:` key. Local builds from the checkout except the two images below. [ADR 0033](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0033-image-signing-keyless.md) is the signing record. [ADR 0030](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0030-pangolin-checks-at-our-edge.md) and [ADR 0032](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0032-self-signed-dev-edge.md) are the dev edge and Newt records.

| Service | `compose.dev.yaml` | `compose.local.yaml` |
| --- | --- | --- |
| `postgres` | lock ref, image | `deployment/images/postgres.Dockerfile` |
| `migrate` | lock ref, image | `deployment/images/migrate.Dockerfile` |
| `pds` | `ghcr.io/undefined6799/mirror/pds` by the lock digest | `ghcr.io/bluesky-social/pds:0.4.5037` by the `bases.lock.json` digest |
| `edge` | lock ref, image | `deployment/edge/Dockerfile`, context `deployment/edge` |
| `web` | lock ref, image | `deployment/images/node-app.Dockerfile` |
| `newt` | lock ref, image. Address `10.250.37.2` on `newt_edge` | absent |
| `pds-token-reader` | absent | `docker.io/library/node:26-trixie-slim` by the `bases.lock.json` digest. Profile `tools`, `network_mode: none` |

`compose.dev.yaml` has no `ports:` key. The local edge publishes `127.0.0.1:80` and `127.0.0.1:443`. The dev edge's `newt_edge` address is `10.250.37.3`.

Both files set `user`, `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, and `mem_limit`, `cpus`, `pids_limit`. The edge is the service with `cap_add: [NET_BIND_SERVICE]`. The numbers are `deployment/limits.dev.json`.

`deployment/preflight/local-only.ts` names what only one file may hold. `LOCAL_ONLY_SERVICES` is `pds-token-reader`. `DEV_ONLY_SERVICES` is `newt`. `DEV_ONLY_NETWORKS` is `newt_edge` and `newt_egress`. `LOCAL_ONLY_NETWORKS` is empty. `LOCAL_ONLY_KEY_NAMES` is `OAUTH_ALLOW_HTTP`, `NETGUARD_ALLOW_LOOPBACK` and `DEV_VITE_ORIGIN`.

Networks, from `deployment/networks.dev.json`. Under local, C17 leaves the two dev-only rows out.

| Network | `internal` | Members |
| --- | --- | --- |
| `db` | true | `postgres`, `migrate`, `web` |
| `app` | true | `edge`, `web` |
| `edge` | false | `pds`, `edge` |
| `newt_edge` | true | `newt`, `edge` |
| `newt_egress` | false | `newt` |
| `pds_egress` | false | `pds` |
| `web_egress` | false | `web` |

Both compose files set `PDS_DID_PLC_URL` and web's `PLC_URL` to `https://plc.directory`. The comments cite [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) and [ADR 0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md). Both records' status lines say Proposed.

Named volumes in both files: `pgdata`, `pdsdata`, `edgedata`, `edgeconfig`. Secret names are file secrets whose sources sit outside the checkout (`../../unset-dev-secrets/` in the compose files). The runbook is [dev-stack-secrets](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/dev-stack-secrets.md).

Postgres mounts `./postgres/init` at `/docker-entrypoint-initdb.d` in both files. Neither file mounts `deployment/postgres/init-local/`. See [postgres init](../postgres-init/).

## May import

Compose files are not modules. The [deployment](../) import row does not apply to them. The process that reads them is [preflight](../preflight/).

## Entry points

From the repository root (`package.json`):

```sh
npm run dev:up
npm run dev:down
npm run local:up
npm run local:down
```

Those four scripts are:

```sh
node deployment/preflight/stack.ts -- up --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- down --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- up --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- down --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env
```

`up` runs `scripts/dev-precheck.ts`, then `docker compose up -d`. Dev adds `--no-build`. Local adds `--build`. After a local `up`, the wrapper runs `deployment/preflight/served-leaf.ts`. `down` does not pass `-v`. The flag list and the child environment are on [preflight](../preflight/).

`.github/workflows/local-stack.yml` runs `npm run local:up` in jobs `green` and `red`. Its header says it is not a required check.

## Data

Interpolation and env files are not in the checkout. The templates are:

| Template | Copy to | Names |
| --- | --- | --- |
| `deployment/env/dev-public.example.env` | `../unset-dev-env/dev-public.env` | `WEB_PUBLIC_ORIGIN`, `WEB_ALLOWED_HOSTS`, `WEB_MEDIA_ORIGIN`, `APP_HOST`, `PDS_HOSTNAME`, `PDS_SERVICE_HANDLE_DOMAINS`, `EDGE_ACME_EMAIL`, `WEB_OAUTH_ACTIVE_KID` |
| `deployment/env/pds.example.env` | `../unset-dev-env/pds.env` | `PDS_JWT_SECRET`, `PDS_ADMIN_PASSWORD`, `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX`, `PDS_RECOVERY_DID_KEY`, and under dev and prod also `PDS_EMAIL_SMTP_URL`, `PDS_MODERATION_EMAIL_SMTP_URL` |
| `deployment/env/newt.example.env` | `../unset-dev-env/newt.env` | `PANGOLIN_ENDPOINT`, `NEWT_ID`, `NEWT_SECRET` |

Every value in the templates is a placeholder. `deployment/limits.dev.json` holds `mem_limit`, `cpus` and `pids_limit` for the seven service names, including `pds-token-reader`. `deployment/networks.dev.json` is the table above. There is no `networks.prod.json`.
