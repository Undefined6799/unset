---
title: Setup
weight: 1
---

A checkout uses the Node version in `.nvmrc` and the scripts in the root [`package.json`](https://github.com/Undefined6799/unset/blob/main/package.json).

## Node and Docker

| Source | Value |
| --- | --- |
| `.nvmrc` | `26.12.0` |
| `package.json` `engines.node` | `>=26.0.0` |
| `.npmrc` | `engine-strict=true`, `save-exact=true`, `ignore-scripts=true` |

`npm ci` refuses a Node outside that engines range. Install scripts stay off.

`npm run check` needs Docker. Postgres tests start the pinned image with `docker run` from [`tests/support/postgres.ts`](https://github.com/Undefined6799/unset/blob/main/tests/support/postgres.ts) and fail when the daemon is missing. The image is the `postgres` entry in `deployment/images/bases.lock.json`.

## Checkout

From the repository root ([README.md](https://github.com/Undefined6799/unset/blob/main/README.md)):

```sh
npm ci
git config core.hooksPath scripts/githooks
npm run check
```

The hooks are opt-in. [`scripts/githooks/pre-commit`](https://github.com/Undefined6799/unset/blob/main/scripts/githooks/pre-commit) runs gitleaks when it is on `PATH`, then `npm run guards`. [`scripts/githooks/commit-msg`](https://github.com/Undefined6799/unset/blob/main/scripts/githooks/commit-msg) runs `scripts/guards/commit-msg.ts`. CI runs the commit check and gitleaks on the pull request either way. What `npm run check` runs is [Checks](../checks/).

## Scripts

Every script in the root `package.json`:

| Script | Command |
| --- | --- |
| `check` | `npm run typecheck && npm run lint && npm run guards && npm test` |
| `typecheck` | `tsc -b` |
| `lint` | `biome ci . && depcruise --config scripts/lint/.dependency-cruiser.cjs .` |
| `format` | `biome format --write .` |
| `guards` | `vitest run scripts/guards` |
| `notes:index` | `node scripts/guards/notes.ts` |
| `test` | `node scripts/test/run.ts` |
| `test:images` | `node scripts/test/run.ts --images` |
| `budgets` | `node scripts/budgets/check.ts` |
| `semgrep:fixtures` | `node scripts/lint/semgrep-fixtures.ts run` |
| `dev:up` | `node deployment/preflight/stack.ts -- up --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `dev:down` | `node deployment/preflight/stack.ts -- down --env dev --compose deployment/compose.dev.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `dev:source:up` | `node deployment/preflight/stack.ts -- up --env dev --source --compose deployment/compose.dev.source.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `dev:source:down` | `node deployment/preflight/stack.ts -- down --env dev --source --compose deployment/compose.dev.source.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `local:up` | `node deployment/preflight/stack.ts -- up --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env` |
| `local:down` | `node deployment/preflight/stack.ts -- down --env local --compose deployment/compose.local.yaml --interpolation-env ../unset-dev-env/dev-public.env` |

`notes:index` is on [Docs rules](../docs-rules/). The six stack commands are the Compose wrappers. Their files are on [compose](../../areas/deployment/compose/). The interpolation env and the secret files sit outside this checkout.
