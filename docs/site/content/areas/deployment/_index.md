---
title: Deployment
weight: 6
type: docs
cascade:
  type: docs
  params:
    reversePagination: false
---

What puts the system on machines: Compose, the edge, backup and the preflight. Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). The parent section is [Areas](../).

`deployment/` is not an npm workspace. `package.json` `workspaces` lists `apps/*`, `interfaces/*`, `domains/*`, `infrastructure/*` and `shared/*`. `deployment/tsconfig.json` is a composite project that references `shared/host-pin` and `tests`.

| Piece | Path | Page |
| --- | --- | --- |
| compose | `deployment/compose.dev.yaml`, `deployment/compose.local.yaml` | [compose](compose/) |
| edge | `deployment/edge/` | [edge](edge/) |
| images | `deployment/images/`, `deployment/images.lock.json`, `deployment/mirror.list.json`, `deployment/sigstore/` | [images](images/) |
| postgres init | `deployment/postgres/` | [postgres init](postgres-init/) |
| preflight | `deployment/preflight/` | [preflight](preflight/) |
| env templates | `deployment/env/` | [compose](compose/) |
| reserved labels | `deployment/reserved-labels.txt` | this page |
| backup | — | (planned). [Guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md) names backup scripts. No folder on the tree. |
| terraform, ansible | `deployment/terraform/`, `deployment/ansible/` | (planned, Phase 5). [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md) and guideline §1 add them at P5.00, when hosting is chosen. Not on the tree. |
| PDS presentation patches | `deployment/pds/` | (planned). [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) decision 3 names the folder. Not on the tree. The ADR status line says implementation and release gates are pending. |
| PDS presentation package | `apps/pds/` | (planned). [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) decision 3 names the folder. Not on the tree. |
| prod compose | `compose.prod.yaml` | Not on the tree. |
| prod network table | `deployment/networks.prod.json` | Not on the tree. `--env prod` reads that path (`networkTable` in `deployment/preflight/inputs.ts`). |

## Owns

The pieces in the table. `CLAUDE.md` and guideline §1 name compose, edge, backup and preflight. The tree also has images, postgres init, env templates, the Sigstore root, the reserved-label list, `networks.dev.json` and `limits.dev.json`. These pages follow the tree. Rows marked planned are not folders yet. `deployment/postgres/init-local/` is on the tree and is superseded; see [postgres init](postgres-init/).

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

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and `edge-not-preflight`). dependency-cruiser 18.5.0 is pinned in `package.json`. The config states that an edge no row lists fails as `not-in-allowed`. The checked-rule table is [architecture.md](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md). A generator for these tables is a later PR in #1161.

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
| `images` | `.github/workflows/images.yml` | `images`, `edge`, `discover`, `scan-image`, `scan-export`, `pds-ui`, `scan`, `pins` |
| `publish-images` | `.github/workflows/publish-images.yml` | `publish` |
| `mirror` | `.github/workflows/mirror.yml` | `scan`, `copy-and-sign` |
| `sigstore-root` | `.github/workflows/sigstore-root.yml` | `fetch` (`workflow_dispatch` only) |
| `local-stack` | `.github/workflows/local-stack.yml` | `green`, `red` |

`pds-ui` runs `node scripts/ci/pds-ui/build-check.ts`. That script is under `scripts/`. `deployment/pds/` and `apps/pds/` are planned; this job is not a build of those folders.

## Data

No schema and no role roster live here. The init scripts are on [postgres init](postgres-init/). Image locks are on [images](images/). Env templates and `deployment/limits.dev.json` are on [compose](compose/).

`deployment/reserved-labels.txt` is the handle labels no account may take (one lowercase label per line, `#` starts a comment, `_*` and `xn--*` are patterns). `deployment/reserved-labels.test.ts` checks that shape and pins the plan minimum (`www`, `api`, `admin`, `account`, `mail`, `mta-sts`, `autoconfig`, `status`, `_*`). The test comment says `pds-admin` enforces the list at P2.09. `interfaces/pds-admin/` is not on the tree.
