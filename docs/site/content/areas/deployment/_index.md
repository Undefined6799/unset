---
title: Deployment
weight: 6
type: docs
cascade:
  type: docs
  params:
    reversePagination: false
---

What puts the system on machines: Compose, the edge, images and the preflight. Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). The parent section is [Areas](../).

`deployment/` is not an npm workspace. `package.json` `workspaces` lists `apps/*`, `interfaces/*`, `domains/*`, `infrastructure/*` and `shared/*`. `deployment/tsconfig.json` is a composite project that references `shared/host-pin` and `tests`.

| Piece | Path | Page |
| --- | --- | --- |
| compose | `deployment/compose.dev.yaml`, `deployment/compose.dev.source.yaml`, `deployment/compose.local.yaml` | [compose](compose/) |
| edge | `deployment/edge/` | [edge](edge/) |
| images | `deployment/images/`, `deployment/images.lock.json`, `deployment/mirror.list.json`, `deployment/sigstore/` | [images](images/) |
| pds recipe | `deployment/pds/` | [images](images/) |
| postgres init | `deployment/postgres/` | [postgres init](postgres-init/) |
| preflight | `deployment/preflight/` | [preflight](preflight/) |
| env templates | `deployment/env/` | [compose](compose/) |
| reserved labels | `deployment/reserved-labels.txt` | this page |

## Owns

The pieces in the table. `deployment/pds/` is the paired frontend recipe (`Dockerfile`, `source.lock.json`, `README.md`, `build.test.ts`, `ui/unset-theme.css`, `ui/theme.test.ts`); [images](images/) describes it. The `pds` service images are on [compose](compose/). The `/deployment/` supply-chain row below covers `deployment/pds/`. The tree also has the Sigstore root, the reserved-label list, `networks.dev.json` and `limits.dev.json`. `deployment/postgres/init-local/` is on the tree and is superseded; see [postgres init](postgres-init/).

`.github/CODEOWNERS` (supply chain, then the trusted-base section):

| Path | Section |
| --- | --- |
| `/deployment/` | Supply chain |
| `/deployment/edge/` | Edge, and trusted base |
| `/deployment/postgres/init/` | Trusted base |
| `/deployment/postgres/init-local/` | Trusted base |
| `/deployment/sigstore/` | Trusted base |

`/deployment/postgres/init-local/` is on the tree and in that trusted-base section. It is superseded by [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) and [ADR 0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md). See [postgres init](postgres-init/).

The preflight is product. The edge is trusted base. [architecture.md](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md) records that split as `edge-not-preflight`.

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and `edge-not-preflight`). dependency-cruiser 18.7.0 is pinned in `package.json`. The config states that an edge no row lists fails as `not-in-allowed`. The checked-rule table is [architecture.md](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md).

The only product row whose `from` is under `deployment/` is `deployment-preflight`. A `*.test.ts` is the tooling row, which allows every target. `deployment/edge/caddyfile.ts`, `deployment/edge/image-cleanup.ts` and `deployment/images/vendor.ts` have no import.

| From | May reach |
| --- | --- |
| `deployment/preflight/` | `deployment/preflight/`, `deployment/edge/caddyfile.ts`, `shared/host-pin/index.ts`, the npm package `yaml`, and Node built-ins. |

`yaml` is 2.9.1, a root `devDependency`. `deployment/preflight/compose-parse.ts` imports `parseAllDocuments` from it.

| Rule | Effect |
| --- | --- |
| `edge-not-preflight` | No file under `deployment/edge/`, tests included, imports `deployment/preflight/`. |
| no other product row | `apps/`, `interfaces/`, `domains/`, `infrastructure/` and `shared/` have no row that reaches `deployment/`. |

The preflight runs `scripts/ci/verify-images.ts` and `scripts/dev-precheck.ts` as child processes. It does not import `scripts/`.

## Entry points

No `main.ts`. The commands and the workflows are on [compose](compose/), [preflight](preflight/) and [images](images/).

| Workflow | File | Jobs |
| --- | --- | --- |
| `images` | `.github/workflows/images.yml` | `images`, `edge`, `discover`, `scan-image`, `pds-ui`, `scan`, `pins` |
| `publish-images` | `.github/workflows/publish-images.yml` | `publish` |
| `mirror` | `.github/workflows/mirror.yml` | `scan`, `copy-and-sign` |
| `sigstore-root` | `.github/workflows/sigstore-root.yml` | `fetch` (`workflow_dispatch` only) |
| `local-stack` | `.github/workflows/local-stack.yml` | `green`, `red` |

`pds-ui` runs `node scripts/ci/pds-ui/build-check.ts`. With `deployment/pds/Dockerfile` and `source.lock.json` present, that script builds the recipe and writes `pds-ui-proof.json` under `RUNNER_TEMP` only after `verifyInputs` returns. Both files absent, it prints `pds-ui: no candidate recipe or source lock` and returns. The script is under `scripts/`.

## Data

No schema and no role roster live here. The init scripts are on [postgres init](postgres-init/). Image locks, including `deployment/pds/source.lock.json`, are on [images](images/). Env templates and `deployment/limits.dev.json` are on [compose](compose/).

`deployment/reserved-labels.txt` is the handle labels no account may take (one lowercase label per line, `#` starts a comment, `_*` and `xn--*` are patterns). `deployment/reserved-labels.test.ts` checks that shape and pins `PLAN_LABELS` (`www`, `api`, `admin`, `account`, `mail`, `mta-sts`, `autoconfig`, `status`, `_*`).
