---
title: Dev stack
weight: 1
---

The npm scripts start `deployment/compose.dev.yaml`, `deployment/compose.dev.source.yaml` and `deployment/compose.local.yaml`. Service images, networks and limits are on [compose](../../areas/deployment/compose/). The checks that run first are on [preflight](../../areas/deployment/preflight/). How to create the files outside the checkout is [dev-stack secrets](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/dev-stack-secrets.md).

## Commands

From the repository root (`package.json`):

```sh
npm run dev:up
npm run dev:down
npm run dev:source:up
npm run dev:source:down
npm run local:up
npm run local:down
```

| Script | Body |
| --- | --- |
| `dev:up` | `node deployment/preflight/stack.ts -- up --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `dev:down` | `node deployment/preflight/stack.ts -- down --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `dev:source:up` | `node deployment/preflight/stack.ts -- up --env dev --source --compose deployment/compose.dev.source.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `dev:source:down` | `node deployment/preflight/stack.ts -- down --env dev --source --compose deployment/compose.dev.source.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `local:up` | `node deployment/preflight/stack.ts -- up --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `local:down` | `node deployment/preflight/stack.ts -- down --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env` |

## Compose files

| `--env` | File | `name` | Services |
| --- | --- | --- | --- |
| `dev` | `deployment/compose.dev.yaml` | `unset-dev` | `postgres`, `migrate`, `pds`, `edge`, `web`, `newt` |
| `dev --source` | `deployment/compose.dev.source.yaml` | `unset-dev` | as `dev`, with `postgres`, `migrate`, `pds`, `edge` and `web` built from the checkout (P1.37y, ADR 0036) |
| `local` | `deployment/compose.local.yaml` | `unset-local` | `postgres`, `migrate`, `pds`, `edge`, `web`, `pds-token-reader` |

The wrapper usage in `deployment/preflight/stack.ts` accepts `dev` or `local`. `--source` is accepted with `dev` only, and at most once. `scripts/dev-precheck.ts` applies the same two refusals. The preflight usage in `deployment/preflight/inputs.ts` also accepts `prod`, and refuses `--source` the same way.

## What the wrapper runs

`deployment/preflight/stack.ts` `plan` builds the commands. `up` runs three steps under `local`, and the first two under `dev`:

1. `node scripts/dev-precheck.ts` with the same `--env`, `--compose` and `--interpolation-env`, plus `--source` when the wrapper was given it (`preflightFlags`).
2. `docker compose -f <file> --env-file <file> up -d`, then `--build` when `--env` is `local` or `--source` was given, and `--no-build` when `--env` is `dev` without `--source`.
3. Under `local` only, `node deployment/preflight/served-leaf.ts -- --env local`. That command's `undo` is the `down` command below. `runOrUndo` runs `undo` when the command's exit code is not 0.

`down` is `docker compose -f <file> --env-file <file> down`. `--source` on `down` is not passed to Compose.

`WRAPPER_OPTIONS` is `env`, `compose`, `interpolation-env` and `source`. `plan` calls `refuseComposeVariables`: a caller environment name that starts with `COMPOSE_` throws `UsageError`. `childEnv` copies `PATH`, `HOME`, `DOCKER_CONFIG` and `DOCKER_CERT_PATH` when they are set (`CHILD_ENV_NAMES`), and always sets `NODE_OPTIONS` to empty and `DOCKER_HOST` from `localDockerHost`. `run` calls `refuseRemoteDaemon` before those commands. That function runs `docker info` and requires the reported `Name` to equal this machine's hostname.

`scripts/dev-precheck.ts` then runs the preflight. `hostnamePin` returns `precheck.production_host` for an empty host, for `PRODUCTION_HOST` (`unset.ac`), for a dev host other than `DEV_HOST` (`staging.unset.ac`), and for a local host that fails `LOCAL_HOST`. `didVerdict` returns `precheck.unknown_pds_did` when `describeServer` returns a `did` other than `did:web:` plus that hostname. The check list is on [preflight](../../areas/deployment/preflight/).

## Files beside the checkout

Compose `file:` and `env_file:` paths are relative to the compose file, so `../../` is the checkout's parent (`deployment/compose.dev.yaml` header).

| Path beside the checkout | Read by |
| --- | --- |
| `unset-dev-env/dev-public.env` | All six npm scripts, as `--interpolation-env`. The template header says this is the file to copy the template to. |
| `unset-dev-env/pds.env` | `env_file` on `pds` in all three compose files. |
| `unset-dev-env/newt.env` | `env_file` on `newt` in `deployment/compose.dev.yaml` and `deployment/compose.dev.source.yaml`. |
| `unset-dev-secrets/` | `secrets.*.file` in all three compose files. |
| `unset-dev-trust/` | Bind `../../unset-dev-trust:/etc/unset-dev-trust:ro` on `pds` and `web` in `deployment/compose.local.yaml`. `devTrustFolder` in `deployment/preflight/checks/secrets.ts` is this folder. `devTrustJudged` is true only for `local`. |
| `unset-dev-ca/` | `devCaFolder` in `deployment/preflight/checks/secrets.ts`. C9 fails when a secret or env file reaches it (`devCaInputProblem`). C26 fails when a build context reaches it (`contextProblem` in `deployment/preflight/checks/build.ts`). |

C9 also fails when a secret or env file is inside the Compose project directory (`insideProjectProblem`). C26 fails when a build context reaches the secrets folder or holds an env file.

## Templates

Every value in the templates is a placeholder. The runbook is how to fill the live files.

| Template | Copy to | Names |
| --- | --- | --- |
| `deployment/env/dev-public.example.env` | `../unset-dev-env/dev-public.env` | `WEB_PUBLIC_ORIGIN`, `WEB_ALLOWED_HOSTS`, `WEB_MEDIA_ORIGIN`, `APP_HOST`, `PDS_HOSTNAME`, `PDS_SERVICE_HANDLE_DOMAINS`, `EDGE_ACME_EMAIL`, `WEB_OAUTH_ACTIVE_KID` |
| `deployment/env/pds.example.env` | `../unset-dev-env/pds.env` | `PDS_JWT_SECRET`, `PDS_ADMIN_PASSWORD`, `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX`, `PDS_RECOVERY_DID_KEY`, `PDS_EMAIL_SMTP_URL`, `PDS_MODERATION_EMAIL_SMTP_URL` |
| `deployment/env/newt.example.env` | `../unset-dev-env/newt.env` | `PANGOLIN_ENDPOINT`, `NEWT_ID`, `NEWT_SECRET` |

## Secret files

Basenames of the `file:` secrets. Owner, mode and how to create each file are in the [runbook](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/dev-stack-secrets.md).

| File | Compose file |
| --- | --- |
| `pg_superuser_password`, `pg_migrator_password`, `pg_tap_password`, `migrate_pg_password`, `pg_web_password`, `pg_api_password`, `pg_indexer_password`, `web_seal_keyring`, `web_oauth_client_keys` | all three |
| `dev_tls_cert`, `dev_tls_key` | `deployment/compose.dev.yaml`, `deployment/compose.dev.source.yaml` |
| `local_tls_cert`, `local_tls_key` | `deployment/compose.local.yaml` |
