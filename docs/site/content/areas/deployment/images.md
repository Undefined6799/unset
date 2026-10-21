---
title: Images
weight: 3
---

The Dockerfiles, the lock of images a dev or prod stack may run, the upstream bases, and the Sigstore root those signatures verify against. [ADR 0033](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0033-image-signing-keyless.md) is the signing record.

## Owns

| File | Builds | Runtime |
| --- | --- | --- |
| `deployment/images/node-app.Dockerfile` | `web`, `APP=web` | `USER 65532:65532`. `ENTRYPOINT ["node", "interfaces/http/main.ts"]`. `EXPOSE 8080`. Health check is `GET /health` on `LISTEN_PORT`. Label licence `AGPL-3.0-only`. |
| `deployment/images/migrate.Dockerfile` | `migrate` | `USER 65532:65532`. `ENTRYPOINT ["node", "infrastructure/postgres/migrate-cli.ts"]`. Label licence `AGPL-3.0-only`. |
| `deployment/images/postgres.Dockerfile` | `postgres` | `USER 999:999`. No `ENTRYPOINT` of our own. Health check is `pg_isready`. Label licence `AGPL-3.0-only AND PostgreSQL`. |
| `deployment/edge/Dockerfile` | `edge` | On [edge](../edge/). |

`deployment/images/kinds.json` maps a base name to the image kind the image tests iterate: `node` → `node`, `caddy` → `edge`, `postgres` → `postgres`.

`deployment/images/vendor.ts` exports `VENDOR_IMAGES`: `ghcr.io/bluesky-social/pds` and `docker.io/fosrl/newt`. It imports nothing. The preflight repeats that set in `deployment/preflight/checks/images.ts` because it may not import this file. `deployment/compose.dev.test.ts` holds the two equal.

`deployment/images/bases.lock.json` pins the bases by digest:

| Key | `ref` | `tag` | `stage` |
| --- | --- | --- | --- |
| `node` | `docker.io/library/node` | `26-trixie-slim` | runtime |
| `caddy-builder` | `docker.io/library/caddy` | `2.11.7-builder-alpine` | build |
| `caddy` | `docker.io/library/caddy` | `2.11.7-alpine` | runtime |
| `postgres` | `docker.io/library/postgres` | `18-trixie` | runtime |
| `pds` | `ghcr.io/bluesky-social/pds` | `0.4.5037` | runtime |
| `newt` | `docker.io/fosrl/newt` | `1.18.1` | runtime |

`deployment/mirror.list.json` lists the same six sources. Each `mirror` is `ghcr.io/undefined6799/mirror/<name>`.

`deployment/images.lock.json` is what dev and prod run. Every entry has `verify: cosign-keyless`.

| Name | `origin` | Image |
| --- | --- | --- |
| `postgres`, `migrate`, `edge`, `web` | `first-party` | `ghcr.io/undefined6799/unset/<name>@sha256:…` |
| `pds` | `upstream` | `ghcr.io/undefined6799/mirror/pds`, `upstreamSource` the Bluesky `0.4.5037` ref |
| `newt` | `upstream` | `ghcr.io/undefined6799/mirror/newt`, `upstreamSource` `docker.io/fosrl/newt:1.18.1` |

The digest strings live in the lock. This page does not copy them.

`deployment/sigstore/trusted_root.json` is the trusted root C3 and C4 verify against. `deployment/sigstore/trusted_root.test.ts` pins its sha256 and checks the media type `application/vnd.dev.sigstore.trustedroot+json;version=0.1`, a Rekor log at `https://rekor.sigstore.dev`, and a Fulcio authority at `https://fulcio.sigstore.dev`. The file header says a refresh is a new `sigstore-root` run plus a trusted-base PR. CODEOWNERS lists `/deployment/sigstore/` as trusted base.

## May import

`vendor.ts` has no import. There is no `MATRIX` row whose `from` is `deployment/images/`. The preflight may not import `vendor.ts`. Tests under this folder are the tooling row. The row that does exist is on [deployment](../).

## Entry points

`scripts/ci/list-dockerfiles.ts` lists Dockerfiles under `deployment/` for the `discover` job. The pattern in its header is a path matching `Dockerfile` or `<name>.Dockerfile`.

| Workflow | When | What the file header says |
| --- | --- | --- |
| `.github/workflows/images.yml` | ready pull request, push to `main` | `images` builds `deployment/images/node-app.Dockerfile` for `APP=web`. `edge` builds `deployment/edge/Dockerfile`. `discover`, `scan-image` and `scan-export` cover every Dockerfile `list-dockerfiles.ts` emits. `scan` is green only when `discover`, `scan-image`, `scan-export` and `pds-ui` succeeded. Nothing in this workflow pushes or signs. |
| `.github/workflows/publish-images.yml` | push to `main`, or `workflow_dispatch` | Job `publish`, environment `signing`. Builds each image under `deployment/` from the checked-out commit, pushes by digest, scans, signs and attests with keyless cosign, then runs `scripts/ci/verify-images.ts`. |
| `.github/workflows/mirror.yml` | push to `main`, and weekly `scan` | `scan` runs Trivy on every `source` in `deployment/mirror.list.json`. `copy-and-sign` copies each source to its GHCR mirror by the same digest and signs it. It does not run on the weekly schedule. |
| `.github/workflows/sigstore-root.yml` | `workflow_dispatch` | Job `fetch`. Installs cosign v3.1.3 and uploads `trusted_root.json` as a run artifact. It does not commit. |

cosign in those workflows and in `deployment/preflight/cosign.ts` is v3.1.3. The preflight expects the binary at `/usr/local/bin/cosign`. The sha256 values are `COSIGN.sha256` in that file and `COSIGN_SHA256` in the workflows.

The dev stack does not build. `npm run dev:up` passes `--no-build`. See [compose](../compose/).

## Data

The locks, `kinds.json`, `mirror.list.json` and `trusted_root.json` above. No schema, role or table.

`deployment/images.lock.json` is the deploy lock. `deployment/images/bases.lock.json` is the base lock. A service under `--env dev` or `--env prod` runs the deploy lock, not a base tag.
