---
title: Compose
weight: 1
---

The files the wrapper starts. `deployment/compose.dev.yaml` is the homelab file. `deployment/compose.dev.source.yaml` is that file with the built services taken from the checkout. `deployment/compose.local.yaml` is the throwaway file on one machine. There is no `compose.prod.yaml` on the tree.

## Owns

`deployment/compose.dev.yaml` and `deployment/compose.dev.source.yaml` (`name: unset-dev`) and `deployment/compose.local.yaml` (`name: unset-local`). All three are read by the preflight's parser (`deployment/preflight/compose-parse.ts`), not by `docker compose config`. The file headers state the subset that parser accepts: no interpolation outside `environment` (local also allows it in network aliases), no `healthcheck`, no `command`.

`compose.dev.yaml` runs each service's `deployment/images.lock.json` ref, by digest, and has no `build:` key. `compose.dev.source.yaml` replaces `image:` with the local `build:` on `postgres`, `migrate`, `pds`, `edge`, `web` and `objects`, adds `pds-admin`, `indexer` and `review` (`SOURCE_ONLY_SERVICES` in `deployment/preflight/local-only.ts`), and leaves `newt` on the lock ref (`deployment/compose.dev.source.test.ts`). Local builds those same services from the checkout and adds `pds-token-reader`, whose image is the locked Node image with no Dockerfile. [ADR 0033](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0033-image-signing-keyless.md) is the signing record. [ADR 0030](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0030-pangolin-checks-at-our-edge.md) and [ADR 0032](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0032-self-signed-dev-edge.md) are the dev edge and Newt records. [ADR 0036](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0036-staging-builds-from-source.md) is the `--source` record.

| Service | `compose.dev.yaml` | `compose.dev.source.yaml` | `compose.local.yaml` |
| --- | --- | --- | --- |
| `postgres` | lock ref, image | same build as local | `deployment/images/postgres.Dockerfile` |
| `migrate` | lock ref, image | same build as local | `deployment/images/migrate.Dockerfile` |
| `pds` | `ghcr.io/undefined6799/unset/pds` by the lock digest: the official `0.4.5051` image with its whole `@atproto/oauth-provider-ui` dist replaced: sign-in, consent, account and error pages (ADR 0027, P2.24y) | same build as local | `deployment/pds/pds.Dockerfile`, context `.` |
| `edge` | lock ref, image | same build as local | `deployment/edge/Dockerfile`, context `deployment/edge` |
| `web` | lock ref, image | same build as local | `deployment/images/node-app.Dockerfile` |
| `objects` | lock ref, image | same build as local | `deployment/images/objects.Dockerfile` |
| `pds-admin` | absent (`SOURCE_ONLY_SERVICES`) | `deployment/images/pds-admin.Dockerfile` | same build as source |
| `indexer` | absent (`SOURCE_ONLY_SERVICES`) | `deployment/images/indexer.Dockerfile` | same build as source |
| `review` | absent (`SOURCE_ONLY_SERVICES`) | `deployment/images/review.Dockerfile` | same build as source |
| `newt` | lock ref, image. Address `10.250.37.2` on `newt_edge` | same image as dev | absent |
| `pds-token-reader` | absent | absent | `docker.io/library/node:26-trixie-slim` by the `bases.lock.json` digest. Profile `tools`, `network_mode: none` |

`compose.dev.yaml` and `compose.dev.source.yaml` have no `ports:` key. The local edge publishes `127.0.0.1:80` and `127.0.0.1:443`. The dev edge's `newt_edge` address is `10.250.37.3` in both dev files.

All three files set `user`, `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, and `mem_limit`, `cpus`, `pids_limit`. The edge is the service with `cap_add: [NET_BIND_SERVICE]`. The numbers are `deployment/limits.dev.json`.

`deployment/preflight/local-only.ts` names what only one file may hold. `LOCAL_ONLY_SERVICES` is `pds-token-reader`. `DEV_ONLY_SERVICES` is `newt`. `DEV_ONLY_NETWORKS` is `newt_edge` and `newt_egress`. `SOURCE_ONLY_SERVICES` is `pds-admin`, `indexer` and `review`: they are in `compose.local.yaml` and `compose.dev.source.yaml`, and absent from `compose.dev.yaml`. `LOCAL_ONLY_NETWORKS` is empty. `LOCAL_ONLY_KEY_NAMES` is `OAUTH_ALLOW_HTTP` and `NETGUARD_ALLOW_LOOPBACK`.

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

All three compose files set `PDS_DID_PLC_URL` and web's `PLC_URL` to `https://plc.directory`. The comments cite [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) and [ADR 0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md). Those records supersede a local PLC. The pages follow these files.

Named volumes in all three files: `pgdata`, `pdsdata`, `edgedata`, `edgeconfig`. Secret names are file secrets whose sources sit outside the checkout (`../../unset-dev-secrets/` in the compose files). The runbook is [dev-stack-secrets](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/dev-stack-secrets.md).

Postgres mounts `./postgres/init` at `/docker-entrypoint-initdb.d` in all three files. `deployment/postgres/init-local/` is not mounted. It is superseded by the same ADRs. See [postgres init](../postgres-init/).

## May import

Compose files are not modules. The [deployment](../) import row does not apply to them. The process that reads them is [preflight](../preflight/).

## Entry points

From the repository root (`package.json`):

```sh
npm run dev:up
npm run dev:down
npm run dev:source:up
npm run dev:source:down
npm run local:up
npm run local:down
```

Those six scripts are:

```sh
node deployment/preflight/stack.ts -- up --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- down --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- up --env dev --source --compose deployment/compose.dev.source.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- down --env dev --source --compose deployment/compose.dev.source.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- up --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env
node deployment/preflight/stack.ts -- down --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env
```

`up` runs `scripts/dev-precheck.ts`, then `docker compose up -d`. Dev without `--source` adds `--no-build`. `--env dev --source` and local add `--build`. After a local `up`, the wrapper runs `deployment/preflight/served-leaf.ts`. `down` does not pass `-v`. `--source` on `down` is not passed to Compose. The flag list and the child environment are on [preflight](../preflight/).

`.github/workflows/local-stack.yml` runs `npm run local:up` in jobs `green` and `red`. Its `changes` job runs `scripts/guards/docs-only.ts` first, and a pull request whose every path is on the docs-only allowlist starts neither. Its header says it is not a required check.

## Data

Interpolation and env files are not in the checkout. The templates are:

| Template | Copy to | Names |
| --- | --- | --- |
| `deployment/env/dev-public.example.env` | `../unset-dev-env/dev-public.env` | `WEB_PUBLIC_ORIGIN`, `WEB_ALLOWED_HOSTS`, `WEB_MEDIA_ORIGIN`, `APP_HOST`, `PDS_HOSTNAME`, `PDS_SERVICE_HANDLE_DOMAINS`, `EDGE_ACME_EMAIL`, `WEB_OAUTH_ACTIVE_KID` |
| `deployment/env/pds.example.env` | `../unset-dev-env/pds.env` | `PDS_JWT_SECRET`, `PDS_ADMIN_PASSWORD`, `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX`, `PDS_RECOVERY_DID_KEY`, and under dev and prod also `PDS_EMAIL_SMTP_URL`, `PDS_MODERATION_EMAIL_SMTP_URL` |
| `deployment/env/newt.example.env` | `../unset-dev-env/newt.env` | `PANGOLIN_ENDPOINT`, `NEWT_ID`, `NEWT_SECRET` |

Every value in the templates is a placeholder. `deployment/limits.dev.json` holds `mem_limit`, `cpus` and `pids_limit` for the seven service names, including `pds-token-reader`. `deployment/networks.dev.json` is the table above. There is no `networks.prod.json`.
