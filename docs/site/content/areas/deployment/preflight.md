---
title: Preflight
weight: 5
---

The check that runs before `compose up`. One command, no flag to skip a check. The plan for the rules is cited in `deployment/preflight/index.ts`. This page lists what the code on this tree checks.

## Owns

`deployment/preflight/`. The CLI is `index.ts`. The stack wrapper is `stack.ts`. The parser is `compose-parse.ts` (`yaml` 2.9.1, `parseAllDocuments`). Env values are held in `secret-map.ts`. `printable.ts` is what a line may contain.

`index.ts` exit codes: 0 when every check passes, 1 when one fails, 2 when the inputs cannot be read. A throw is a failure. C3, C4, C5 and C24 are `network: true` and fail after 30 s (`NETWORK_TIMEOUT_MS`). A reason that contains a configured value is replaced with a fixed withheld line. Output is one `PASS`, `FAIL` or `UNSIGNED` line per check. `UNSIGNED` is only a pass (`verdict` in `index.ts`). Under `--env local` the run appends `LOCAL_LAST_LINE`: `LOCAL unsigned, local-only stack: never deploy it`. Under `--source` the run appends `SOURCE_LAST_LINE`: `SOURCE built from the checkout, unsigned: staging only`. `--source` is refused unless `--env` is `dev` (`inputs.ts`), so a run appends at most one of those lines. C3, C4 and C5 still verify the lock under `--source`. They return `UNSIGNED` only under local.

`ENVS` in `inputs.ts` is `dev`, `prod` and `local`. There is no prod compose file and no `deployment/networks.prod.json`.

Checks, in `CHECKS` order (`deployment/preflight/checks/index.ts`). `LOCAL_CHECKS` (`L1`, `L2`) run only under `--env local`, after the others.

| Id | File | What the check requires |
| --- | --- | --- |
| C1 | `checks/stack.ts` | `name` is `unset-` plus `--env`. |
| C2 | `checks/images.ts` | Dev and prod without `--source`: no `build`, and every image is `ghcr.io/undefined6799/…` by digest and in `deployment/images.lock.json`. Under `--env dev --source`: a service may build, with no image beside it, when C26 passes; a service that names an image keeps the lock rule. Local: a build C26 accepts, a run-only vendor image by tag and digest, or the token reader on the node base with `network_mode: none` and profile `tools`. |
| C3 | `checks/images.ts` | First-party lock entries verify. Local returns `UNSIGNED`. |
| C4 | `checks/images.ts` | Upstream lock entries verify. Local returns `UNSIGNED`. |
| C5 | `checks/images.ts` | Every lock digest is an OCI index or a Docker manifest list. Local returns `UNSIGNED`. |
| C6 | `checks/pds.ts` | `PDS_RECOVERY_DID_KEY` is set and `isAtprotoDidKey` accepts it (secp256k1 or P-256 `did:key`). |
| C7 | `checks/pds.ts` | `PDS_INVITE_REQUIRED` is `true`. Outside prod, `PDS_CRAWLERS` is empty. `PDS_ADMIN_PASSWORD` length is at least 32. `PDS_RATE_LIMITS_ENABLED` is `false`. |
| C8 | `checks/pds.ts` | No name starting `PDS_RATE_LIMIT_BYPASS_` in any service environment. |
| C9 | `checks/secrets.ts` | Each secret file the stack reads exists and is non-empty. Compose-read files are mode `0600` and owned by the deploy user. Mounted file secrets are mode `0400` and owned by the service uid, inside a `0700` directory. None of them resolve inside the project directory. |
| C10 | `checks/stack.ts` | Under dev, no service publishes a port. Otherwise only `edge` publishes 80 and 443, and every other published port binds `127.0.0.1`. |
| C11 | `checks/pds.ts` | `PDS_EMAIL_SMTP_URL` is `smtps:` or `smtp:` with a single `requireTLS=true`, and is not Mailpit. `PDS_EMAIL_FROM_ADDRESS` passes `fromAddressProblem`. Local: both names absent. |
| C12 | `checks/pds.ts` | If `LOG_ENABLED` is set, it is `false`. If `LOG_LEVEL` is set, it is `info`, `warn`, `error`, `fatal` or `silent`. |
| C13 | `checks/settings.ts` | `PDS_LEXICON_AUTHORITY_DID` is unset. |
| C14 | `checks/settings.ts` | No name containing `DEV_MODE`, and no `PDS_` name containing `DISABLE`, except `PDS_EMAIL_DISABLE_CONFIRMATION_LINK` when the value is `true`. |
| C15 | `checks/settings.ts` | `PDS_SERVICE_HANDLE_DOMAINS` is set, is not `.0x40.me`, is exactly `.staging.unset.im` under dev, and under local is under the PDS `.localhost` host. |
| C16 | `checks/settings.ts` | `PDS_EMAIL_DISABLE_CONFIRMATION_LINK` is `true`. |
| C17 | `checks/networks.ts` | No `network_mode` except `none` on `pds-token-reader` in profile `tools`. Membership matches `deployment/networks.dev.json` or, under prod, `deployment/networks.prod.json`, with the local-only and dev-only rows in `local-only.ts`. |
| C18 | `checks/edge.ts` | Local: the built edge's mounts and secrets are the local set, then the site rules. Dev and prod: the edge serves the PDS host. Without a build it runs the lock's edge image. Under `--env dev --source`, an edge that builds must be `deployment/edge/Dockerfile`, a build C26 passes, and no image beside it (`runsBuilt` in `checks/build.ts`); the lock ref is not what that service runs. Dev also requires `PDS_HOST` `staging.unset.ac` and web's `PUBLIC_ORIGIN` host to be the dev app host. |
| C19 | `checks/settings.ts` | Moderation mail under the C11 TLS rule, and `PDS_MODERATION_EMAIL_ADDRESS` passes `fromAddressProblem`. Local: both names absent. |
| C20 | `checks/settings.ts` | No name starting `PDS_MOD_SERVICE_`. |
| C21 | `checks/host.ts` | Under dev, one fixed skip line (`C21_DEV_WAIVER`). Otherwise, if `PDS_HOSTNAME` is `0x40.space`, `docs/human/retirement/retirement-check.json` has `retirement_part_a_complete: true`. Any other host skips. |
| C22 | `checks/settings.ts` | Local and dev: `PDS_BLOB_UPLOAD_LIMIT` is `5242880`, `PDS_BLOBSTORE_DISK_TMP_LOCATION` is unset, and the PDS tmpfs is `/tmp` with `size=20m`. When `VIDEO_MASTER_MAX_BYTES` is set, the upload limit is an integer at least that large. |
| C23 | `checks/settings.ts` | Prod: some service sets `FINGERPRINT_CHECK` to `arachnid`, and no service sets `FAKE_FINGERPRINT_LIST`. Other envs skip. |
| C24 | `checks/host.ts` | `timedatectl` reports `NTPSynchronized=yes`. When `chronyc tracking` runs, the offset is at most 1 second. A `PDS_HOSTNAME` ending in `.localhost` skips. |
| C25 | `checks/capabilities.ts` | A service with `cap_add` runs the edge. Under local, and under `--env dev --source` when that service builds, `runsBuilt` (`checks/build.ts`) requires `deployment/edge/Dockerfile`, a build C26 passes, and no image beside it. Otherwise it runs the lock's `edge` ref. Under dev, `lockOrNone` still reads `deployment/images.lock.json`. |
| C26 | `checks/build.ts` | Each build's Dockerfile is one `scripts/ci/list-dockerfiles.ts` discovers, the context is the one that workflow uses, and the context does not reach the secrets folder, the dev CA folder, or an env file. |
| C27 | `checks/build.ts` | A tmpfs on `/var/run/postgresql` is only on the service that runs the postgres image. |
| C28 | `checks/pds.ts` | `PDS_DID_PLC_URL` is set and is `https://plc.directory`. |
| C29 | `checks/local-only-keys.ts` | Dev and prod: no `LOCAL_ONLY_KEY_NAMES` key, and each origin key is `https:` (`ASSETS_BASE` may be empty). Local skips. |
| C30 | `checks/pds.ts` | The `pds` service has one env file. Its names are the four `PDS_ENV_SECRETS`, plus the two mail URLs under dev and prod. Those names are not also set in the compose `environment`. |
| C31 | `checks/newt.ts` | Dev requires a `newt` service. Its one env file holds `PANGOLIN_ENDPOINT`, `NEWT_ID` and `NEWT_SECRET`. Compose `environment` is the six `NEWT_SETTINGS` literals. No mount and no secret. Outside local it runs the lock's `newt` ref. Local may omit it. |
| C32 | `checks/placeholders.ts` | Dev and prod: no environment value starts with `[to fill:`. Local skips. |
| L1 | `checks/local.ts` | Every published port binds `127.0.0.1`. |
| L2 | `checks/local.ts` | `PDS_HOSTNAME` matches a `.localhost` name. |

C3 and C4 call `inputs.verify`, which runs `node scripts/ci/verify-images.ts <lock> --trusted-root deployment/sigstore/trusted_root.json` (`inputs.ts`). The cosign binary is `deployment/preflight/cosign.ts`: `/usr/local/bin/cosign`, v3.1.3. The preflight does not import `scripts/`.

`scripts/dev-precheck.ts` is the child `stack.ts` runs before Compose. Its header says it refuses a production PDS host (`PRODUCTION_HOST` is `unset.ac`) and a foreign `describeServer` DID, then runs this preflight, and creates no account. `preflightFlags` adds `--source` only when the wrapper passed it.

## May import

The `deployment-preflight` row. dependency-cruiser 18.7.0 is pinned in `package.json`. An edge no row lists fails as `not-in-allowed`.

| From | May reach |
| --- | --- |
| `deployment/preflight/` | `deployment/preflight/`, `deployment/edge/caddyfile.ts`, `shared/host-pin/index.ts`, npm package `yaml` (2.9.1), Node built-ins. |

`stack.ts` imports `hostWalk`, `localDockerHost` and `UsageError` from `@unset/shared-host-pin`. `checks/build.ts` and `checks/secrets.ts` import `resolveChecked` and the walk reasons from the same package index.

`edge-not-preflight`: nothing under `deployment/edge/` imports this folder. Tests are the tooling row and are not this row. The rest of the boundary is on [deployment](../).

## Entry points

```sh
node deployment/preflight/index.ts -- --env dev|prod|local --compose <absolute file> [--compose <absolute file>...] [--interpolation-env <absolute file>] [--source]
```

```sh
node deployment/preflight/stack.ts -- up|down --env dev|local --compose <file> [--compose <file>...] --interpolation-env <file> [--source]
```

`CLI_OPTIONS` in `deployment/preflight/inputs.ts` and `WRAPPER_OPTIONS` in `deployment/preflight/stack.ts` are `env`, `compose`, `interpolation-env` and `source`. `scripts/dev-precheck.ts` `CLI_OPTIONS` is the same four. No name starts with `env-file`, `require` or `import`. The commands put `--` before those flags. `index.ts` and `stack.ts` cite Node v26.10.0 for why. `.nvmrc` is `26.12.0`. `--source` is a boolean, at most once, and only with `--env dev`, in all three parsers.

`stack.ts` `CHILD_ENV_NAMES` is `PATH`, `HOME`, `DOCKER_CONFIG` and `DOCKER_CERT_PATH`. `childEnv` also sets `NODE_OPTIONS` to empty and `DOCKER_HOST` from `localDockerHost`. A `COMPOSE_*` variable in the caller's environment is refused. `up` passes `--build` when `--env` is `local` or `--source` was given, and `--no-build` when `--env` is `dev` without `--source`. `up` under local then runs `served-leaf.ts`. `down` does not pass `-v`. `--source` on `down` is accepted under dev and is not passed to Compose (`plan`).

The `npm run` scripts are on [compose](../compose/).

## Data

Reads, and does not own:

| Path | Used by |
| --- | --- |
| `deployment/images.lock.json` | C2, C3, C4, C5, C18, C25, C27, C31 |
| `deployment/images/bases.lock.json` | C2 under local |
| `deployment/sigstore/trusted_root.json` | C3, C4 |
| `deployment/networks.dev.json` or `deployment/networks.prod.json` | C17. Local reads the dev file. |
| `RETIREMENT_REPORT` in `deployment/preflight/inputs.ts` | C21, when the host is `0x40.space`. The constant is `docs/human/retirement/retirement-check.json`. |
| compose file, interpolation env, secret files | the inputs |

No schema, role or table. Configured values stay in `SecretMap` and are not printed.
