---
title: Shared
weight: 5
---

Generic code with no product meaning. MIT, recorded in [ADR 0012](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0012-licence.md). Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). Folders are created with their first code.

Each package on the tree has `"license": "MIT"` in its `package.json` and a `LICENSE` file.

| Package | Path | Status |
| --- | --- | --- |
| config | `shared/config` | [config](config/) |
| errors | `shared/errors` | [errors](errors/) |
| host-pin | `shared/host-pin` | [host-pin](host-pin/) |
| http | `shared/http` | [http](http/) |
| islands | `shared/islands` | [islands](islands/) |
| lexicons | `shared/lexicons` | [lexicons](lexicons/) |
| log | `shared/log` | [log](log/) |
| ui | `shared/ui` | [ui](ui/) |
| ui-build | `shared/ui-build` | [ui-build](ui-build/) |
| i18n | `shared/i18n` | (planned). The folder is not on the tree. Decision 34 and ADR 0012 name it. The step book names P1.19 in the i18n slice. |
| admin-envelope | `shared/admin-envelope` | (planned, Phase 3). The folder is not on the tree. The step book names it at P3.16. |

## Owns

The nine packages above. `i18n` is the catalog slice. `admin-envelope` is the signed admin-action format the zero-dependency admin services may import.

`.github/CODEOWNERS` names paths that do not exist yet on purpose (its header). `shared/admin-envelope/` is one of those. The cruiser already has row `shared-admin-envelope` and lists the path in `ZERO_DEP_ALLOWLIST` (`scripts/lint/.dependency-cruiser.cjs`).

| Path | CODEOWNERS section |
| --- | --- |
| `shared/http/` | Security review, and trusted base |
| `shared/config/` | Security review |
| `shared/islands/` | Security review, and trusted base |
| `shared/ui/islands/` | Security review |
| `shared/ui/safe-href.ts` | Security review, and trusted base |
| `shared/lexicons/` | Security review, and trusted base |
| `shared/admin-envelope/` | Security review, and trusted base. The folder is not on the tree. |

## May import

Transcribed from `scripts/lint/.dependency-cruiser.cjs` (`MATRIX` and the `forbidden` rules named here). dependency-cruiser 18.5.0 is pinned in `package.json`. The checked-rule table that names these rules is `docs/human/architecture.md`. The config states that an edge no row lists fails as `not-in-allowed`. A generator for these tables is a later PR in #1161.

`shared-leaf`: `shared/` imports nothing under `apps/`, `interfaces/`, `domains/` or `infrastructure/`.

The general `shared` row applies where `LEAF_SHARED` does not. `LEAF_SHARED` is `ui`, `ui-build`, `islands`, `lexicons`, `admin-envelope` and `host-pin`. Those six have their own rows, on each package page.

| From | May reach |
| --- | --- |
| `shared/config/`, `shared/errors/`, `shared/http/`, `shared/log/` | `shared/`, Node built-ins, and npm dependency types `npm`, `npm-dev`, `npm-optional`, `npm-peer`, `npm-bundled`. |

Who may reach `shared/`:

| From | May reach |
| --- | --- |
| `apps/<app>/` | `shared/` |
| `interfaces/<name>/`, except `pds-admin` and `chat-admin` | `shared/` |
| `domains/<name>/` | `shared/errors/`, `shared/lexicons/`, and `shared/config/` as types only |
| `infrastructure/<name>/`, except `net-guard` | `shared/` |
| `deployment/preflight/` | `shared/host-pin/index.ts` |
| `interfaces/pds-admin/`, `interfaces/chat-admin/` | `shared/admin-envelope/` only. The folder is not on the tree. |
| `infrastructure/net-guard/` | Nothing under `shared/` |
| Tooling (`scripts/`, `tests/`, `*.test.ts`, an app `vite.config.ts`) | The tooling row, which allows every target |

`infra-shared-via-index` (rule DC-2): from outside a package, and from another `shared/` or `infrastructure/` package, the only file reached is that package's `index.ts`. A `*.fake.ts` and a `.css` file are the exceptions the rule names.

Rules that also narrow an edge the rows would allow:

| Rule | Effect |
| --- | --- |
| `no-product-imports-tooling` | Product code does not import `scripts/` or `tests/`. |
| `fake-only-in-composition-root` | A `*.fake.ts` is imported by tests and `interfaces/*/compose.ts`. |
| `vendor-sdk-one-adapter` | `@atproto/lex*` is imported only under `shared/lexicons/`. |
| `lexicon-scripts-not-imported` | Nothing outside `shared/lexicons/scripts/` imports that folder. |
| `island-import-boundary` | A `*.island.tsx` may import `shared/ui/`, `shared/islands/`, `react/jsx-runtime`, and type-only modules. |

## Entry points

No package here has a `main.ts`. The file another workspace imports is `index.ts`.

| Package | Import |
| --- | --- |
| `@unset/shared-config` | [config](config/) |
| `@unset/shared-errors` | [errors](errors/) |
| `@unset/shared-host-pin` | [host-pin](host-pin/) |
| `@unset/shared-http` | [http](http/) |
| `@unset/shared-islands` | [islands](islands/) |
| `@unset/shared-lexicons` | [lexicons](lexicons/) |
| `@unset/shared-log` | [log](log/) |
| `@unset/shared-ui` | [ui](ui/) |
| `@unset/shared-ui-build` | [ui-build](ui-build/) |

## Data

No schema, role or table lives under `shared/`. Lexicon JSON is on [lexicons](lexicons/). Sheet copies, tokens and icons are on [ui](ui/).
