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

The six folders under `interfaces/` on this tree. Each one is its own package and its own process. `interfaces/http` is the web server. The other five start the server kit and register no routes of their own.

| Process | Path | Page |
| --- | --- | --- |
| http | `interfaces/http` | [http](./http/) |
| admin | `interfaces/admin` | [admin](admin/) |
| api | `interfaces/api` | [api](api/) |
| indexer | `interfaces/indexer` | [indexer](indexer/) |
| media | `interfaces/media` | [media](media/) |
| review | `interfaces/review` | [review](review/) |

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and the `forbidden` rules named here). dependency-cruiser 18.6.0 is pinned in `package.json`. An edge no row lists fails as `not-in-allowed`.

The `interface` row matches `interfaces/<name>/` except the paths `ADMIN_SERVICES` names (`interfaces/pds-admin/` and `interfaces/chat-admin/`). Those paths are strings in `scripts/lint/.dependency-cruiser.cjs`.

| From | May reach |
| --- | --- |
| `interfaces/<name>/` | Its own folder, `domains/`, `infrastructure/`, `shared/`, Node built-ins (`dependencyTypes: core`), and npm types `npm`, `npm-dev`, `npm-optional`, `npm-peer`, `npm-bundled`. |

Extra rows, and the rules that refuse an edge the row would otherwise allow:

| Rule | Effect |
| --- | --- |
| `interface-http-render` | `interfaces/http/` may also import the file `apps/web/render.tsx`. |
| `interface-http-render-build` | `interfaces/http/web/render-entry.ts` may import `@unset/apps-web/server` when that specifier does not resolve. |
| `interface-admin-render` | `interfaces/admin/` may also import the path `RENDER_ENTRIES.admin` names (`apps/admin/render.tsx`). |
| `admin-service` | `ADMIN_SERVICES` names `interfaces/pds-admin/` and `interfaces/chat-admin/`. The row allows `node:*`, that path, and `ZERO_DEP_ALLOWLIST` (`shared/admin-envelope/`). No npm. `admin-services-zero-deps` states the same bound. |
| `no-interface-to-interface` | An interface does not import another interface. |
| `app-render-entry-only` | From outside `apps/`, only `interfaces/http` and `interfaces/admin` import an app, and only the path `RENDER_ENTRIES` names in the two rows above. |
| `web-not-admin` | `interfaces/http/` imports nothing whose path is `admin/…` or contains `/admin/`. |
| `infra-shared-via-index` | From outside, `infrastructure/<name>/` and `shared/<name>/` are reached through `index.ts`. A `*.fake.ts` and a `.css` file are the exceptions this rule allows. |
| `fake-only-in-composition-root` | A `*.fake.ts` is imported only by tests and by `interfaces/<name>/compose.ts`, and only with a dynamic `import()` after the `UNSET_ENV` check. |
| `no-product-imports-tooling` | Product code does not import `scripts/` or `tests/`. |
| `vendor-sdk-one-adapter` | `pg`, `undici`, `@atproto/oauth-client-node`, `@atproto/api`, `age-encryption` and `@atproto/lex*` are imported only in their adapter folders, not from an interface. |

## Entry points

No `index.ts` under `interfaces/`. Each process starts at `main.ts`, which calls `bootOrExit(config)` and `compose`.

| Process | Start | Composition root | In a container today |
| --- | --- | --- | --- |
| http | `interfaces/http/main.ts` | `interfaces/http/compose.ts` | Yes. `deployment/images/node-app.Dockerfile` sets `ENTRYPOINT ["node", "interfaces/http/main.ts"]`. Compose service `web` runs that image (`deployment/compose.dev.yaml`, `deployment/compose.local.yaml`). |
| admin | `interfaces/admin/main.ts` | `interfaces/admin/compose.ts` | No image entrypoint and no Compose service names this process. |
| api | `interfaces/api/main.ts` | `interfaces/api/compose.ts` | No image entrypoint and no Compose service names this process. |
| indexer | `interfaces/indexer/main.ts` | `interfaces/indexer/compose.ts` | No image entrypoint and no Compose service names this process. |
| media | `interfaces/media/main.ts` | `interfaces/media/compose.ts` | No image entrypoint and no Compose service names this process. |
| review | `interfaces/review/main.ts` | `interfaces/review/compose.ts` | No image entrypoint and no Compose service names this process. |

`main.ts` for http also runs `boot()` before `listen`. The other five call `listen` on the composed server and do not run a database boot check.

Dev stack, from the repository root (`package.json`):

```sh
npm run dev:up
```

That starts Compose service `web` (`UNSET_SERVICE: http`). It does not start the other five processes.

## Data

Postgres roles for these processes are in `infrastructure/postgres/roles.json`. Grants are in `infrastructure/postgres/grant-matrix.json`. Schemas `app`, `idx`, `audit` and `types` are created in `infrastructure/postgres/migrations/0002_schemas.sql`. Role creation and `CONNECT` are in `migrations/0003_roles_and_grants.sql`.

`infrastructure/postgres/roles.ts` syncs passwords only when `passwordFrom` is not null.

Only [http](./http/) opens a pool. The other five `compose.ts` files build the server kit and nothing else. Per-role grants are on each page.

`review_egress` is a role in `roles.json` (`connectionLimit` 4 is `review`; `review_egress` is 2).
