---
title: Domains
weight: 3
type: docs
cascade:
  type: docs
  params:
    reversePagination: false
---

Product rules. Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). A folder appears with its first code.

| Domain | Path | Page |
| --- | --- | --- |
| identity | `domains/identity` | [identity](identity/) |

## Owns

Product rules, in product words. A domain defines the contracts it needs. An interface's composition root wires the implementations. [identity](identity/) is the only domain folder on the tree.

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and the `forbidden` rules named here). dependency-cruiser 18.5.0 is pinned in `package.json`. An edge no row lists fails as `not-in-allowed`. The checked-rule table is [`docs/human/architecture.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md).

The `domain` row:

| From | May reach |
| --- | --- |
| `domains/<name>/` | Its own folder, any `domains/<other>/index.ts`, `shared/errors/`, `shared/lexicons/`, `shared/config/` as a type-only import, and Node built-ins (`dependencyTypes: core`). |

The row does not list npm. A product file that imports an npm package fails as `not-in-allowed`. A `*.test.ts` also matches the `tooling` row, whose one `to` has no constraint, so a test may reach any target the `forbidden` rules still allow.

Rules that refuse an edge the row would otherwise allow:

| Rule | Effect on a domain |
| --- | --- |
| `domain-pure` | No import from `infrastructure/`, `interfaces/` or `apps/`. |
| `domain-cross-via-index` | Another domain is reached only through its `index.ts`. |
| `domain-no-io-builtins` | No `node:fs`, `node:net`, `node:http`, `node:https`, `node:http2`, `node:dgram`, `node:dns`, `node:tls`, `node:child_process` or `node:worker_threads`. The prefix `node:` is optional in the rule. A test file under `domains/` is included. |
| `infra-shared-via-index` | From outside, `shared/<name>/` is reached through its `index.ts`. A `*.fake.ts` and a `.css` file are the exceptions this rule allows. |
| `no-product-imports-tooling` | Product code does not import `scripts/` or `tests/`. |
| `vendor-sdk-one-adapter` | `pg`, `undici`, `@atproto/oauth-client-node`, `@atproto/api`, `age-encryption` and `@atproto/lex*` are imported only in their adapter folders. `SDK_ADAPTERS` also names the path `infrastructure/storage/` for `@aws-sdk/client-s3` and the path `apps/chat/matrix/` for `matrix-js-sdk`. |

`node:crypto` is a built-in the `domain` row allows and `domain-no-io-builtins` does not name. The fixture is `scripts/lint/depcruise.test.ts`.

## Entry points

No `main.ts` and no `compose.ts`. A domain is a library. Its package export is `index.ts`. The only package on the tree is `@unset/domains-identity`. Its exports are on [identity](identity/).

## Data

No schema, role, table or event type lives under `domains/`.

Postgres roles are `infrastructure/postgres/roles.json`. Grants are `infrastructure/postgres/grant-matrix.json`. The `types.did` column type is `infrastructure/postgres/migrations/0004_types.sql`. None of those files is this area.
