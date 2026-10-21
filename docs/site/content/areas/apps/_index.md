---
title: Apps
weight: 1
---

Screens, islands and styles. UI only: no product rules and no database access. Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). Folders are created with their first code.

| App | Path | Page |
| --- | --- | --- |
| web | `apps/web` | [web](web/) |

## Owns

[web](web/) is the public site, and it is the only app folder on the tree. `RENDER_ENTRIES` in `scripts/lint/.dependency-cruiser.cjs` names `apps/web/render.tsx` for `interfaces/http` and `apps/admin/render.tsx` for `interfaces/admin`. `SDK_ADAPTERS` names `matrix-js-sdk` in `apps/chat/matrix/`.

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and the `forbidden` rules named here). dependency-cruiser 18.5.0 is pinned in `package.json`. The checked-rule table that names these rules is `docs/human/architecture.md`.

The `app` row. The config states that an edge no row lists fails as `not-in-allowed`.

| From | May reach |
| --- | --- |
| `apps/<app>/` | Its own folder, `shared/`, and npm dependency types `npm`, `npm-dev`, `npm-optional`, `npm-peer`, `npm-bundled`. |

Rules that refuse an edge the row would otherwise allow:

| Rule | Effect on an app |
| --- | --- |
| `no-app-to-app` | No import from another app. |
| `app-only-shared` | No import from another repository root (`interfaces/`, `domains/`, `infrastructure/`, `deployment/`, `scripts/`, `tests/`). `apps/<app>/vite.config.ts` is outside this rule. |
| `app-build-config-imports` | `apps/<app>/vite.config.ts` may also import Node built-ins and `scripts/ui/css-scope.ts`. |
| `app-build-config-not-imported` | Nothing imports `apps/<app>/vite.config.ts`. |
| `infra-shared-via-index` | A module under `shared/<name>/` is reached through its `index.ts`. A `.css` file is the exception this rule allows. |
| `fake-only-in-composition-root` | A `*.fake.ts` is imported by tests and `interfaces/*/compose.ts`. An app does not import one. |
| `island-import-boundary` | A `*.island.tsx` may import `shared/ui/`, `shared/islands/`, `react/jsx-runtime`, and type-only modules. |
| `no-product-imports-tooling` | Product code does not import `scripts/` or `tests/`. The Vite config row above is the exception the cruiser states. |
| `vendor-sdk-one-adapter` | Each SDK in `SDK_ADAPTERS` is imported only in its adapter folder. The `apps/` entry in that list is `matrix-js-sdk` in `apps/chat/matrix/`. |
| `web-not-admin` | `apps/web` imports nothing whose path is `admin/…` or contains `/admin/`. |

## Entry points

An app has no `main.ts`. The serving interface may import that app's render file and nothing else under `apps/` (`app-render-entry-only`, `RENDER_ENTRIES`).

| Interface | Render file | On this tree |
| --- | --- | --- |
| `interfaces/http` | `apps/web/render.tsx` | [web](web/) |
| `interfaces/admin` | `apps/admin/render.tsx` | `interfaces/admin` does not import an app. |

`interfaces/http/web/render-entry.ts` and `tests/e2e/fixtures/servers.ts` are the two files allowed to import the unresolved specifier `@unset/apps-web/server` (`RENDER_BUILD_MODULE`). Tests and `scripts/` are the tooling row, which `app-render-entry-only` excludes.

## Data

No schema, role, or table lives under `apps/`.

The name `web` on the Postgres role is the http process. The Compose service `web` sets `UNSET_SERVICE: http` and `PG_USER: web` in `deployment/compose.dev.yaml` and `deployment/compose.local.yaml`. `interfaces/http/config.ts` spreads `postgresFields`, and `infrastructure/postgres/config.ts` reads `PG_USER` as the connection user.
