---
title: Interfaces
weight: 2
type: docs
cascade:
  type: docs
  params:
    reversePagination: false
---

Entry points. One folder per running process. Decision 34 is recorded in [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md).

Route tables are on [Endpoints](/endpoints/). This section does not list paths.

## Owns

On this tree: `interfaces/web` (the web server), `interfaces/indexer`, `interfaces/media`, `interfaces/pds-admin` and `interfaces/review`. The other processes in guideline §1 get their folder with their first code (decision 34).

| Process | Path | Page |
| --- | --- | --- |
| web | `interfaces/web` | [web](./web/) |
| indexer | `interfaces/indexer` | |
| media | `interfaces/media` | |
| pds-admin | `interfaces/pds-admin` | |
| review | `interfaces/review` | |

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and the `forbidden` rules named here). dependency-cruiser 18.7.0 is pinned in `package.json`. An edge no row lists fails as `not-in-allowed`.

The `interface` row matches `interfaces/<name>/` except the paths `ADMIN_SERVICES` names (`interfaces/pds-admin/` and `interfaces/chat-admin/`). Those paths are strings in `scripts/lint/.dependency-cruiser.cjs`.

| From | May reach |
| --- | --- |
| `interfaces/<name>/` | Its own folder, `domains/`, `infrastructure/`, `shared/`, Node built-ins (`dependencyTypes: core`), and npm types `npm`, `npm-dev`, `npm-optional`, `npm-peer`, `npm-bundled`. |

Extra rows, and the rules that refuse an edge the row would otherwise allow:

| Rule | Effect |
| --- | --- |
| `interface-web-components` | `interfaces/web/` may import `apps/web/lib/`, `apps/web/app.css` and `apps/web/legal/*.md`. |
| `interface-web-build` | `interfaces/web/server.ts` may import `#kit/handler` and `#kit/manifest` when those specifiers do not resolve. |
| `interface-admin-render` | `interfaces/admin/` may also import the path `RENDER_ENTRIES.admin` names (`apps/admin/render.tsx`). |
| `admin-service` | `ADMIN_SERVICES` names `interfaces/pds-admin/` and `interfaces/chat-admin/`. The row allows `node:*`, that path, and `ZERO_DEP_ALLOWLIST` (`shared/admin-envelope/`). No npm. `admin-services-zero-deps` states the same bound. |
| `no-interface-to-interface` | An interface does not import another interface. |
| `app-render-entry-only` | From outside `apps/`, only `interfaces/web` and `interfaces/admin` import an app, and only what their own rows allow. |
| `web-not-admin` | `interfaces/web` and `apps/web` import nothing whose path is `admin/…` or contains `/admin/`. |
| `infra-shared-via-index` | From outside, `infrastructure/<name>/` and `shared/<name>/` are reached through `index.ts`. A `*.fake.ts` and a `.css` file are the exceptions this rule allows. |
| `fake-only-in-composition-root` | A `*.fake.ts` is imported only by tests and by `interfaces/<name>/compose.ts`, and only with a dynamic `import()` after the `UNSET_ENV` check. |
| `no-product-imports-tooling` | Product code does not import `scripts/` or `tests/`. |
| `vendor-sdk-one-adapter` | `pg`, `undici`, `@atproto/oauth-client-node`, `@atproto/api`, `age-encryption` and `@atproto/lex*` are imported only in their adapter folders, not from an interface. |

## Entry points

No `index.ts` under `interfaces/`. The web process starts at `interfaces/web/server.ts`. A process that is not the web server starts at `main.ts`.

| Process | Start | Composition root | In a container today |
| --- | --- | --- | --- |
| web | `interfaces/web/server.ts` | `interfaces/web/src/lib/server/compose.ts` | Yes. `deployment/images/node-app.Dockerfile` sets `ENTRYPOINT ["node", "interfaces/web/server.ts"]`. Compose service `web` runs that image (`deployment/compose.dev.yaml`, `deployment/compose.local.yaml`). |
| media | `interfaces/media/main.ts` | `interfaces/media/compose.ts` | No. No Compose file on main runs it. |
| review | `interfaces/review/main.ts` | `interfaces/review/compose.ts` | Only the stacks built from the checkout (`SOURCE_ONLY_SERVICES` in `deployment/preflight/local-only.ts`): `deployment/compose.dev.source.yaml` and `deployment/compose.local.yaml`. Not `deployment/compose.dev.yaml`. |

`server.ts` loads settings with `bootOrExit` and listens after the SvelteKit `init` hook has built the adapters.

Dev stack, from the repository root (`package.json`):

```sh
npm run dev:up
```

That starts Compose service `web` (`UNSET_SERVICE: http`).

## Data

Postgres roles for these processes are in `infrastructure/postgres/roles.json`. Grants are in `infrastructure/postgres/grant-matrix.json`. Schemas `app`, `idx`, `audit` and `types` are created in `infrastructure/postgres/migrations/0002_schemas.sql`. Role creation and `CONNECT` are in `migrations/0003_roles_and_grants.sql`.

`infrastructure/postgres/roles.ts` syncs passwords only when `passwordFrom` is not null.

[web](./web/) and `interfaces/indexer` each open a pool. `roles.json` also lists roles for processes that have no folder on this tree. Per-role grants for `web` are on its page.

`review_egress` is a role in `roles.json` (`connectionLimit` 4 is `review`; `review_egress` is 2).
