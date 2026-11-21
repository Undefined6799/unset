---
title: Images
weight: 3
---

The Dockerfiles, the lock of images a dev or prod stack may run, the upstream bases, and the Sigstore root those signatures verify against. [ADR 0033](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0033-image-signing-keyless.md) is the signing record.

## Owns

| File | Builds | Runtime |
| --- | --- | --- |
| `deployment/images/node-app.Dockerfile` | `web`, `APP=web` | `USER 65532:65532`. `ENTRYPOINT ["node", "interfaces/web/server.ts"]`. `EXPOSE 8080`. Health check is `GET /health` on `LISTEN_PORT`. Label licence `AGPL-3.0-only`. |
| `deployment/images/migrate.Dockerfile` | `migrate` | `USER 65532:65532`. `ENTRYPOINT ["node", "infrastructure/postgres/migrate-cli.ts"]`. Label licence `AGPL-3.0-only`. |
| `deployment/images/postgres.Dockerfile` | `postgres` | `USER 999:999`. No `ENTRYPOINT` of our own. Health check is `pg_isready`. Label licence `AGPL-3.0-only AND PostgreSQL`. |
| `deployment/edge/Dockerfile` | `edge` | On [edge](../edge/). |
| `deployment/pds/pds.Dockerfile` | `pds` | Three stages. `ui-build` is `FROM` the `node` digest in `bases.lock.json`. It copies `shared/ui/theme.css` and `deployment/pds/ui/unset-theme.css` and appends both to `packages/oauth/oauth-provider-ui/src/style.css` before `sha256sum`. The build context is the repository root. `ui-artifact` is `FROM scratch` and copies `/dist`. The final stage is `FROM` the `pds` digest in `bases.lock.json`, then `RUN rm -rf` of `source.lock.json`'s `uiDirectory` and `COPY --from=ui-artifact /dist/` into that path. No `USER`, `ENTRYPOINT`, `EXPOSE`, `HEALTHCHECK` or licence label in this file. |

`deployment/pds/source.lock.json` pins that official image and the Node builder to the same refs as the `pds` and `node` rows of `bases.lock.json` (`deployment/pds/build.test.ts`, `paired_recipe_matches_the_locked_official_and_builder_images`). The lock's platform is `linux/amd64`. Builder Node, builder pnpm, the source revision and the oauth-provider-ui directory live in `deployment/pds/source.lock.json` as `builder.node`, `builder.pnpm`, `source.revision` and `uiDirectory`. `scripts/ci/pds-ui/contract.ts` (`recipeContract`) requires `FROM <builder.ref> AS ui-build`, `FROM scratch AS ui-artifact`, one `ADD` of the locked archive, and a final stage of exactly `FROM` the base, `RUN rm -rf /<uiDirectory>` and `COPY --from=ui-artifact /dist/ /<uiDirectory>/`. The theme `COPY` and the append are in `ui-build`. `COPY` lines in that stage sit outside the check, and the final stage stays those three lines. One file without the other, or a pair that fails those checks, throws. Both files absent, it returns null. `deployment/pds/ui/theme.test.ts` (`recipe_appends_the_theme_before_the_source_is_hashed`) requires `COPY ui/unset-theme.css /unset-theme.css` and that the append precedes `sha256sum`. `pds_light_colours_equal_the_design_sheet` and `pds_dark_colours_equal_the_design_sheet` hold each colour that test maps equal to the token in `shared/ui/src/tokens.css`. `pds_theme_loads_only_edge_fonts` requires the only `url()` values to be `/_unset/fonts/SpaceGrotesk-Variable.woff2` and `/_unset/fonts/JetBrainsMono-Variable.woff2`. [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) is the record. The digest strings stay in the locks.

`deployment/images/kinds.json` maps a base name to the image kind the image tests iterate: `node` → `node`, `caddy` → `edge`, `postgres` → `postgres`.

`deployment/images/vendor.ts` exports `VENDOR_IMAGES`: `ghcr.io/bluesky-social/pds` and `docker.io/fosrl/newt`. It also exports `VENDOR_BASES`: `docker.io/chrislusf/seaweedfs`, a runtime base only and never a member of `VENDOR_IMAGES` ([ADR 0041](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0041-object-store.md)). It imports nothing. The preflight repeats `VENDOR_IMAGES` in `deployment/preflight/checks/images.ts` because it may not import this file. `deployment/compose.dev.test.ts` holds the two equal.

`deployment/images/bases.lock.json` pins the bases by digest:

| Key | `ref` | `tag` | `stage` |
| --- | --- | --- | --- |
| `node` | `docker.io/library/node` | `26-trixie-slim` | runtime |
| `caddy-builder` | `docker.io/library/caddy` | `2.11.9-builder-alpine` | build |
| `caddy` | `docker.io/library/caddy` | `2.11.9-alpine` | runtime |
| `postgres` | `docker.io/library/postgres` | `18-trixie` | runtime |
| `pds` | `ghcr.io/bluesky-social/pds` | `0.4.5051` | runtime |
| `newt` | `docker.io/fosrl/newt` | `1.20.0` | runtime |
| `seaweedfs` | `docker.io/chrislusf/seaweedfs` | `4.53` | runtime |

`deployment/mirror.list.json` lists the same seven sources. Each `mirror` is `ghcr.io/undefined6799/mirror/<name>` (`seaweedfs` is `ghcr.io/undefined6799/mirror/seaweedfs`).

`deployment/images/node-app.Dockerfile`, `deployment/images/migrate.Dockerfile` and `deployment/images/postgres.Dockerfile` build `FROM ghcr.io/undefined6799/mirror/<name>@sha256:<digest>` with the same digests as `bases.lock.json` (`deployment/edge/Dockerfile` still builds `FROM docker.io/library/caddy` by those digests). `deployment/images/images.test.ts` and `deployment/images/package-manager.image.test.ts` map a mirror spelling back to its `mirror.list.json` source and check that source against the lock. While `recipeContract` returns a lock, both tests leave `pds/pds.Dockerfile` out of that set. The load runs `recipeContract` through `execFileSync`. A missing or malformed member throws. Every other Dockerfile stays in the set.

`deployment/images.lock.json` is what `compose.dev.yaml` and a prod stack run, and what `newt` runs under `compose.dev.source.yaml`. Every entry has `verify: cosign-keyless`. Each `first-party` entry also names its `gitCommit`, the commit publish-images built it from. `verify-images.ts` checks that it equals the one source commit in the image's signed provenance (P2.26h). An `upstream` entry has none.

| Name | `origin` | Image |
| --- | --- | --- |
| `postgres`, `migrate`, `edge`, `web` | `first-party` | `ghcr.io/undefined6799/unset/<name>@sha256:…` |
| `pds` | `first-party` | `ghcr.io/undefined6799/unset/pds`, built by publish-images from `deployment/pds/pds.Dockerfile` on the Bluesky `0.4.5051` image (P2.24y) |
| `newt` | `upstream` | `ghcr.io/undefined6799/mirror/newt`, `upstreamSource` `docker.io/fosrl/newt:1.20.0` |

The digest strings live in the lock. This page does not copy them.

`deployment/sigstore/trusted_root.json` is the trusted root C3 and C4 verify against, and the root `.github/workflows/mirror.yml` `copy-and-sign` passes to `cosign verify` for a `docker.io/chrislusf/seaweedfs:<tag>@<digest>` source. `deployment/sigstore/trusted_root.test.ts` pins its sha256 and checks the media type `application/vnd.dev.sigstore.trustedroot+json;version=0.1`, a Rekor log at `https://rekor.sigstore.dev`, and a Fulcio authority at `https://fulcio.sigstore.dev`. The file header says a refresh is a new `sigstore-root` run plus a trusted-base PR. CODEOWNERS lists `/deployment/sigstore/` as trusted base.

## May import

`vendor.ts` has no import. There is no `MATRIX` row whose `from` is `deployment/images/`. The preflight may not import `vendor.ts`. Tests under this folder are the tooling row. The row that does exist is on [deployment](../).

## Entry points

`scripts/ci/list-dockerfiles.ts` lists Dockerfiles under `deployment/` for the `discover` job and for `publish-images.yml`. The pattern in its header is a path matching `Dockerfile` or `<name>.Dockerfile`. `deployment/pds/pds.Dockerfile` matches. Its name is `pds`. While `recipeContract` accepts the pair, that row's ignore file is `.github/trivyignore.pds.yaml`. Every other row's ignore file is `/dev/null` (`IGNOREFILES` is empty). A refused pair throws before any image is listed.

| Workflow | When | What the file header says |
| --- | --- | --- |
| `.github/workflows/images.yml` | ready pull request, push to `main` | `changes` runs `scripts/guards/docs-only.ts`; on a pull request whose every path is on the docs-only allowlist, `images`, `edge`, `discover`, `scan-image` and `pds-ui` are skipped and `scan` is green. Any other verdict, a failed `changes` job, or a push to `main` runs them all. `images` builds `deployment/images/node-app.Dockerfile` for `APP=web`. `edge` builds `deployment/edge/Dockerfile`. `discover` runs `scripts/ci/list-dockerfiles.ts`. `scan-image` builds and scans every Dockerfile that list emits, including `deployment/pds/pds.Dockerfile` (context `.`). The vulnerability scan reads the ignore file that list emitted for that image. The exported-filesystem secret scan is a step of `scan-image` on that same build: it runs after a failed vulnerability scan too, and never when the build failed, and it passes `--ignorefile /dev/null`. `pds-ui` runs `node scripts/ci/pds-ui/build-check.ts`. `scan` is green only when `discover`, `scan-image` (both scans) and `pds-ui` succeeded. Nothing in this workflow pushes or signs. |
| `.github/workflows/publish-images.yml` | push to `main`, `paths-ignore` `docs/**`, `tests/**`, `deployment/images.lock.json` and `deployment/compose.dev.yaml` (the last two since P2.26m, so a merged lock bump does not publish again). A push that changes only those paths starts no run (no `signing` approval). The run still starts when the diff cannot be computed (more than 1,000 commits, or a timeout). `publish_skips_only_what_no_image_reads` | Job `publish`, environment `signing`. Builds each image `list-dockerfiles.ts` emits from the checked-out commit, including `deployment/pds/pds.Dockerfile` (context `.`, name `pds`, ref `ghcr.io/undefined6799/unset/pds`), pushes by digest, scans each image with the ignore file the list emitted for it, signs and attests with keyless cosign, then runs `scripts/ci/verify-images.ts` on `$RUNNER_TEMP/images.lock.json`. That file records the pushed `pds` ref as `origin: first-party`. `deployment/images.lock.json` stays the deploy lock in the table above. Its `pds` entry is that first-party ref (P2.24y). Compose service images are on [compose](../compose/). |
| `.github/workflows/lock.yml` | ready pull request | Job `lock`, read-only. `scripts/ci/lock-bump.ts` fails when a `first-party` entry the pull request changes names a commit that is not on `main` or is older than the locked one. When the lock changed, cosign verifies every entry with `scripts/ci/verify-images.ts` against `deployment/sigstore/trusted_root.json` (P2.26j). |
| `.github/workflows/mirror.yml` | push to `main` when one changed file is `deployment/mirror.list.json`, `deployment/images/bases.lock.json`, `.github/trivyignore.yaml`, `.github/trivyignore.pds.yaml`, `.github/trivyignore.seaweedfs.yaml`, `.github/trivyignore.newt.yaml`, `.github/workflows/mirror.yml`, `scripts/ci/verify-images.ts` or `deployment/sigstore/trusted_root.json`; weekly `scan` at `17 5 * * 1`. `mirror_runs_for_every_file_it_reads` | Job `scan`, step `scan`, runs Trivy on every `source` in `deployment/mirror.list.json`. A failing source does not fail the step. The job outputs `passed` (a JSON list) and `failed` (a count). A source that failed under any entry is never in `passed`. A list, lock or stage problem fails the step at once, and then neither `verdict` nor `copy-and-sign` runs. Only `docker.io/chrislusf/seaweedfs` reads `.github/trivyignore.seaweedfs.yaml`. That file's cap is `SEAWEEDFS_MAX_DAYS` (30) in `scripts/ci/trivyignore.ts`, and `scripts/ci/waiver-expiry.ts` lists the file. Job `pins` in `.github/workflows/images.yml` uses the same case. Job `verdict` (`needs: scan`, `permissions: {}`) is red when `failed` is not `0` (a missing output counts as red), on a push and on the weekly schedule. `copy-and-sign` copies and signs only an entry whose `source` exactly equals one in `passed`, to its GHCR mirror by the same digest. With none, the copy step fails (`test -s`). Before `crane copy`, a `docker.io/chrislusf/seaweedfs:<tag>@<digest>` source must pass `cosign verify --trusted-root deployment/sigstore/trusted_root.json` against `https://github.com/seaweedfs/seaweedfs/.github/workflows/container_release_unified.yml@refs/tags/<tag>` (issuer `https://token.actions.githubusercontent.com`). It runs on a push to `main` only, not on the weekly schedule. |
| `.github/workflows/sigstore-root.yml` | `workflow_dispatch` | Job `fetch`. Installs cosign v3.1.3 and uploads `trusted_root.json` as a run artifact. It does not commit. |

### From a merge to a new lock

After `publish` verified what it pushed, the second job of `publish-images.yml`, `bump`, opens the lock-bump pull request (P2.26m). It holds `contents: write` and `pull-requests: write` and no signing right, and runs one script, `scripts/ci/lock-bump-pr.ts`. That script writes `deployment/images.lock.json` and the digests in `deployment/compose.dev.yaml` with `scripts/ci/lock-write.ts` onto a `lock-bump/<commit>-<attempt>` branch and opens the pull request. It does not push to `main`. `scripts/guards/workflows.ts` holds the job line for line (`BUMP_JOB_LINES`); an edit to the job, an action bump included, edits the guard too.

What the owner does for a release:

1. Approve the `signing` deployment on the publish run.
2. Open the `lock-bump/…` pull request the run opened and press **Approve workflows to run** in its merge box. A pull request opened with `GITHUB_TOKEN` starts its runs in an approval-required state ([GitHub docs](https://docs.github.com/en/actions/concepts/security/github_token), read 2026-11-15). If no banner shows, close and reopen the pull request.
3. Merge it when the required checks and `lock` are green. Close older bump pull requests: a bump names every first-party image, and `lock` fails an older one once a newer is merged.
4. Pull on the host.

The job needs the repository setting "Allow GitHub Actions to create and approve pull requests" (Settings, Actions, General, Workflow permissions). Steps 2 and 3 are unproven until the first run on `main`.

cosign in those workflows and in `deployment/preflight/cosign.ts` is v3.1.3. The preflight expects the binary at `/usr/local/bin/cosign`. The sha256 values are `COSIGN.sha256` in that file and `COSIGN_SHA256` in the workflows.

`npm run dev:up` passes `--no-build` and runs the lock (`deployment/preflight/stack.ts`). `npm run dev:source:up` passes `--build`. `deployment/compose.dev.source.yaml` builds `postgres`, `migrate`, `pds`, `edge` and `web` from the checkout. `newt` stays the lock digest. See [compose](../compose/).

## Data

The locks, `kinds.json`, `mirror.list.json` and `trusted_root.json` above. No schema, role or table.

`deployment/images.lock.json` is the deploy lock. `deployment/images/bases.lock.json` is the base lock. A service under `--env prod`, or under `--env dev` without `--source`, runs the deploy lock, not a base tag. Under `--env dev --source`, a service with a build and no image is admitted when C26 passes; a service that names an image must still name a lock digest (`deployment/preflight/checks/images.ts`).
