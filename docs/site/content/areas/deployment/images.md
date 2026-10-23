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
| `deployment/pds/Dockerfile` | `pds` | Three stages. `ui-build` is `FROM` the `node` digest in `bases.lock.json`. `ui-artifact` is `FROM scratch` and copies `/dist`. The final stage is `FROM` the `pds` digest in `bases.lock.json`, then `RUN rm -rf` of `source.lock.json`'s `uiDirectory` and `COPY --from=ui-artifact /dist/` into that path. No `USER`, `ENTRYPOINT`, `EXPOSE`, `HEALTHCHECK` or licence label in this file. |

`deployment/pds/source.lock.json` pins that official image and the Node builder to the same refs as the `pds` and `node` rows of `bases.lock.json` (`deployment/pds/build.test.ts`, `paired_recipe_matches_the_locked_official_and_builder_images`). The lock's platform is `linux/amd64`. Its builder versions are Node `26.10.0` and pnpm `11.11.0`. The source revision is `a7c8604d876a200a1e4fa4aec83d4189ac4f1c12`. `uiDirectory` is `app/node_modules/.pnpm/@atproto+oauth-provider-ui@0.10.5/node_modules/@atproto/oauth-provider-ui/dist`. `scripts/ci/pds-ui/contract.ts` (`recipeContract`) requires `FROM <builder.ref> AS ui-build`, `FROM scratch AS ui-artifact`, one `ADD` of the locked archive, and a final stage of exactly `FROM` the base, `RUN rm -rf /<uiDirectory>` and `COPY --from=ui-artifact /dist/ /<uiDirectory>/`. One file without the other, or a pair that fails those checks, throws. Both files absent, it returns null. [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) is the record. The digest strings stay in the locks.

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

`deployment/images/node-app.Dockerfile`, `deployment/images/migrate.Dockerfile` and `deployment/images/postgres.Dockerfile` build `FROM ghcr.io/undefined6799/mirror/<name>@sha256:<digest>` with the same digests as `bases.lock.json` (`deployment/edge/Dockerfile` still builds `FROM docker.io/library/caddy` by those digests). `deployment/images/images.test.ts` and `deployment/images/package-manager.image.test.ts` map a mirror spelling back to its `mirror.list.json` source and check that source against the lock. While `recipeContract` returns a lock, both tests leave `pds/Dockerfile` out of that set. The load runs `recipeContract` through `execFileSync`. A missing or malformed member throws. Every other Dockerfile stays in the set.

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

`scripts/ci/list-dockerfiles.ts` lists Dockerfiles under `deployment/` for the `discover` job and for `publish-images.yml`. The pattern in its header is a path matching `Dockerfile` or `<name>.Dockerfile`. `deployment/pds/Dockerfile` matches. Its name is `pds`. While `recipeContract` accepts the pair, that row's ignore file is `.github/trivyignore.pds.yaml`. Every other row's ignore file is `/dev/null` (`IGNOREFILES` is empty). A refused pair throws before any image is listed.

| Workflow | When | What the file header says |
| --- | --- | --- |
| `.github/workflows/images.yml` | ready pull request, push to `main` | `images` builds `deployment/images/node-app.Dockerfile` for `APP=web`. `edge` builds `deployment/edge/Dockerfile`. `discover` runs `scripts/ci/list-dockerfiles.ts`. `scan-image` builds and scans every Dockerfile that list emits, including `deployment/pds/Dockerfile` (context `deployment/pds`). The vulnerability scan reads the ignore file that list emitted for that image. The exported-filesystem secret scan is a step of `scan-image` on that same build: it runs after a failed vulnerability scan too, and never when the build failed, and it passes `--ignorefile /dev/null`. `pds-ui` runs `node scripts/ci/pds-ui/build-check.ts`. `scan` is green only when `discover`, `scan-image` (both scans) and `pds-ui` succeeded. Nothing in this workflow pushes or signs. |
| `.github/workflows/publish-images.yml` | push to `main` only | Job `publish`, environment `signing`. Builds each image `list-dockerfiles.ts` emits from the checked-out commit, including `deployment/pds/Dockerfile` (context `deployment/pds`, name `pds`, ref `ghcr.io/undefined6799/unset/pds`), pushes by digest, scans each image with the ignore file the list emitted for it, signs and attests with keyless cosign, then runs `scripts/ci/verify-images.ts` on `$RUNNER_TEMP/images.lock.json`. That file records the pushed `pds` ref as `origin: first-party`. `deployment/images.lock.json` stays the deploy lock in the table above. Its `pds` entry stays the upstream mirror. Compose service images are on [compose](../compose/). |
| `.github/workflows/mirror.yml` | push to `main`, and weekly `scan` | `scan` runs Trivy on every `source` in `deployment/mirror.list.json`. `copy-and-sign` copies each source to its GHCR mirror by the same digest and signs it. It does not run on the weekly schedule. |
| `.github/workflows/sigstore-root.yml` | `workflow_dispatch` | Job `fetch`. Installs cosign v3.1.3 and uploads `trusted_root.json` as a run artifact. It does not commit. |

cosign in those workflows and in `deployment/preflight/cosign.ts` is v3.1.3. The preflight expects the binary at `/usr/local/bin/cosign`. The sha256 values are `COSIGN.sha256` in that file and `COSIGN_SHA256` in the workflows.

The dev stack does not build. `npm run dev:up` passes `--no-build`. See [compose](../compose/).

## Data

The locks, `kinds.json`, `mirror.list.json` and `trusted_root.json` above. No schema, role or table.

`deployment/images.lock.json` is the deploy lock. `deployment/images/bases.lock.json` is the base lock. A service under `--env dev` or `--env prod` runs the deploy lock, not a base tag.
