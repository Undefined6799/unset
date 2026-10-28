---
title: Infrastructure
weight: 4
type: docs
cascade:
  type: docs
  params:
    reversePagination: false
---

External systems behind small contracts. Decision 34 is recorded in [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). The checked-rule table is [architecture.md](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md).

## Owns

One package per folder. `SDK_ADAPTERS` in `scripts/lint/.dependency-cruiser.cjs` names one adapter path per vendor SDK.

The tree has `postgres`, `pds`, `net-guard`, `seal`, `audit` and `session`. These pages follow the tree.

| Package | Path | Page |
| --- | --- | --- |
| audit | `infrastructure/audit` | [audit](audit/) |
| net-guard | `infrastructure/net-guard` | [net-guard](net-guard/) |
| pds | `infrastructure/pds` | [pds](pds/) |
| postgres | `infrastructure/postgres` | [postgres](postgres/) |
| seal | `infrastructure/seal` | [seal](seal/) |
| session | `infrastructure/session` | [session](session/) |

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and the `forbidden` rules named here). dependency-cruiser 18.6.0 is pinned in `package.json`. An edge no row lists fails as `not-in-allowed`.

| From | May reach |
| --- | --- |
| `infrastructure/<name>/`, except `net-guard` | Its own folder, `infrastructure/net-guard/`, `infrastructure/seal/`, `domains/`, `shared/`, Node built-ins (`dependencyTypes: core`), and npm types `npm`, `npm-dev`, `npm-optional`, `npm-peer`, `npm-bundled`. |
| `infrastructure/net-guard/` | Its own folder, the npm package `undici`, and Node built-ins. |

The `infrastructure` row's `$1` is the package folder. A package may reach `net-guard` and `seal`. It may not reach another infrastructure package: `session` does not import `postgres`, and `pds` does not import `session`. Callers pass a query function in.

Rules that refuse an edge a row would otherwise allow:

| Rule | Effect |
| --- | --- |
| `infra-shared-via-index` | Another module under `infrastructure/<name>/` or `shared/<name>/` is reached through its `index.ts`. A `*.fake.ts` and a `.css` file are the exceptions this rule allows. `domains/` is not this rule. |
| `infrastructure-not-entry` | No import from `interfaces/` or `apps/`. |
| `net-guard-leaf` | A non-test file under `infrastructure/net-guard/` reaches only its own folder, `undici` and Node built-ins. A `*.test.ts` there may also import `fast-check` and `vitest`. |
| `vendor-sdk-one-adapter` | `pg` only in `infrastructure/postgres/`. `undici` only in `infrastructure/net-guard/`. `@atproto/oauth-client-node` and `@atproto/api` only in `infrastructure/pds/`. `age-encryption` only in `infrastructure/seal/`. `@atproto/lex*` only in `shared/lexicons/`. The list also names the path `infrastructure/storage/` for `@aws-sdk/client-s3` and the path `apps/chat/matrix/` for `matrix-js-sdk`. |
| `no-product-imports-tooling` | Product code does not import `scripts/` or `tests/`. |
| `fake-only-in-composition-root` | A `*.fake.ts` is imported only by tests and by `interfaces/<name>/compose.ts`, and only with a dynamic `import()` after the `UNSET_ENV` check. |

`@unset/infrastructure-seal` does not depend on `age-encryption`. `infrastructure/seal/seal.ts` calls `node:crypto`. The cruiser row is the import rule; the package is absent.

## Entry points

No `main.ts` under `infrastructure/`. Each package publishes `index.ts` (`package.json` export `.`). Rule DC-2 (`infra-shared-via-index`) is that file.

| Package | Public module | Process |
| --- | --- | --- |
| audit | `infrastructure/audit/index.ts` | None. `interfaces/http/compose.ts` does not construct it. `interfaces/http/account.ts` calls `appendAudit`. |
| net-guard | `infrastructure/net-guard/index.ts` | None. `interfaces/http/compose.ts` calls `createNetGuard`. |
| pds | `infrastructure/pds/index.ts` | None. `interfaces/http/compose.ts` calls `createIdentityNetwork`, `createOAuthClient` and `createPdsCall`. |
| postgres | `infrastructure/postgres/index.ts` | `unset-migrate` and `unset-rewrap`. See [postgres](postgres/). |
| seal | `infrastructure/seal/index.ts` | None. `interfaces/http/compose.ts` calls `createSealer`. |
| session | `infrastructure/session/index.ts` | None. `interfaces/http/compose.ts` calls `createSessionStore`. |

## Data

Schemas, roles, grants and migrations live under [postgres](postgres/). `net-guard` and `seal` run no SQL. The other packages name the tables their statements touch on their own pages. `idx` has schema `USAGE` in `grant-matrix.json` and no `CREATE TABLE` in `infrastructure/postgres/migrations/`.
