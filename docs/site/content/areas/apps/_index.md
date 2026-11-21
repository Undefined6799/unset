---
title: Apps
weight: 1
---

Screens and styles. UI only: no product rules and no database access. Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). Folders are created with their first code.

| App | Path | Page |
| --- | --- | --- |
| web | `apps/web` | [web](web/) |

## Owns

[web](web/) is the public site, and it is the only app folder on the tree. `interfaces/web` may import `apps/web/lib/`, `apps/web/app.css` and the markdown files in `apps/web/legal/` (`WEB_COMPONENTS` in `scripts/lint/.dependency-cruiser.cjs`). `RENDER_ENTRIES.admin` still names `apps/admin/render.tsx`. `SDK_ADAPTERS` names `apps/chat/matrix/` for `matrix-js-sdk`. Neither of those folders is on this tree.

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and the `forbidden` rules named here). dependency-cruiser 18.7.0 is pinned in `package.json`. The checked-rule table that names these rules is `docs/human/architecture.md`.

The `app` row. The config states that an edge no row lists fails as `not-in-allowed`.

| From | May reach |
| --- | --- |
| `apps/<app>/` | Its own folder, `shared/`, and npm dependency types `npm`, `npm-dev`, `npm-optional`, `npm-peer`, `npm-bundled`. |

Rules that refuse an edge the row would otherwise allow:

| Rule | Effect on an app |
| --- | --- |
| `no-app-to-app` | No import from another app. |
| `app-only-shared` | No import from another repository root (`interfaces/`, `domains/`, `infrastructure/`, `deployment/`, `scripts/`, `tests/`). `apps/<app>/vite.config.ts` is outside this rule. |
| `app-build-config-imports` | `apps/<app>/vite.config.ts` may also import Node built-ins. |
| `app-build-config-not-imported` | Nothing imports `apps/<app>/vite.config.ts`. |
| `infra-shared-via-index` | A module under `shared/<name>/` is reached through its `index.ts`. A `.css` file is the exception this rule allows. |
| `fake-only-in-composition-root` | A `*.fake.ts` is imported by tests and `interfaces/*/compose.ts`. An app does not import one. |
| `no-product-imports-tooling` | Product code does not import `scripts/` or `tests/`. The Vite config row above is the exception the cruiser states. |
| `vendor-sdk-one-adapter` | Each SDK in `SDK_ADAPTERS` is imported only on the adapter path that list names. The `apps/` entries name the path `apps/chat/matrix/` for `matrix-js-sdk`, and the path `apps/web/src/editor/` for `@blocknote/[^/]+`, `prosemirror-[^/]+` and `@tiptap/[^/]+`. Neither of those folders is on this tree. |
| `web-not-admin` | `apps/web` imports nothing whose path is `admin/…` or contains `/admin/`. |

## Entry points

An app has no `main.ts`. `app-render-entry-only` lets `interfaces/web` and `interfaces/admin` import an app, and only what their own rows allow.

| Interface | What it may import | On this tree |
| --- | --- | --- |
| `interfaces/web` | `apps/web/lib/`, `apps/web/app.css`, `apps/web/legal/*.md` | [web](web/) |
| `interfaces/admin` | `apps/admin/render.tsx` | That folder is not on this tree. |

`interfaces/web/server.ts` is the one file allowed to import the unresolved specifiers `#kit/handler` and `#kit/manifest` (`interface-web-build`).

## Data

No schema, role, or table lives under `apps/`.

The name `web` on the Postgres role is this process. The Compose service `web` sets `UNSET_SERVICE: http` and `PG_USER: web` in `deployment/compose.dev.yaml` and `deployment/compose.local.yaml`. `interfaces/web/src/lib/server/config.ts` spreads `postgresFields`, and `infrastructure/postgres/config.ts` reads `PG_USER` as the connection user.
