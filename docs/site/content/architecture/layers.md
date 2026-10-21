---
title: Layers
weight: 2
---

Product code sits in four layers. `shared/` is generic code with no product meaning. The allowlist is `MATRIX` in `scripts/lint/.dependency-cruiser.cjs` (dependency-cruiser 18.5.0, `package.json`). `npm run lint` runs:

```sh
depcruise --config scripts/lint/.dependency-cruiser.cjs .
```

An import no row lists fails as `not-in-allowed`. The `forbidden` rules name the boundary. The full checked table is [`docs/human/architecture.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md).

## What is in the tree

| Layer | Folders present | Not in the tree |
| --- | --- | --- |
| `apps/` | `web` | `admin`, `chat` **(planned)**; chat is Phase 6 |
| `interfaces/` | `http`, `admin`, `api`, `indexer`, `media`, `review` | `pds-admin`, `chat-admin` **(planned)**; see [Processes](processes.md) |
| `domains/` | `identity` | `content`, `social`, `feed`, `messaging`, `moderation`, `privacy` **(planned)** |
| `infrastructure/` | `audit`, `net-guard`, `pds`, `postgres`, `seal`, `session` | `tap`, `matrix`, `storage`, `arachnid`, `email` **(planned)** |
| `shared/` | `config`, `errors`, `host-pin`, `http`, `islands`, `lexicons`, `log`, `ui`, `ui-build` | `admin-envelope`, `i18n` **(planned)** |

`domains/identity` (`domains/identity/index.ts`) owns who an account is: DID and handle syntax, resolution, `verifyHandle`, and the onboarding and email gates. Network I/O arrives as the `IdentityNetwork` contract. `infrastructure/pds/identity-network.ts` implements that contract on net-guard.

## Allowlist

| Row | From | May reach |
| --- | --- | --- |
| `app` | `apps/<name>/` | its own folder, `shared/`, npm |
| `interface` | `interfaces/<name>/`, except the admin services | its own folder, `domains/`, `infrastructure/`, `shared/`, Node built-ins, npm |
| `interface-http-render` | `interfaces/http/` | `apps/web/render.tsx` |
| `interface-http-render-build` | `interfaces/http/web/render-entry.ts` | the package export `@unset/apps-web/server`, left unresolved until that build exists |
| `interface-admin-render` | `interfaces/admin/` | `apps/admin/render.tsx` **(planned path)** |
| `admin-service` | `interfaces/pds-admin/`, `interfaces/chat-admin/` | its own folder, `shared/admin-envelope/`, Node built-ins |
| `domain` | `domains/<name>/` | its own folder, another domain's `index.ts`, `shared/errors/`, `shared/lexicons/`, `shared/config/` as types only, Node built-ins |
| `infrastructure` | `infrastructure/<name>/` except net-guard | its own folder, `infrastructure/net-guard/`, `infrastructure/seal/`, `domains/`, `shared/`, Node built-ins, npm |
| `net-guard` | `infrastructure/net-guard/` | its own folder, `undici`, Node built-ins |
| `shared` | `shared/`, except the leaf rows | `shared/`, Node built-ins, npm |
| `shared-lexicons-scripts` | `shared/lexicons/scripts/` | `shared/lexicons/`, core modules `fs`, `path`, `os`, `url`, `child_process`, npm |
| `shared-ui-lexicons` | `shared/ui/`, `shared/lexicons/` | its own folder, npm |
| `shared-ui-islands` | `shared/ui/` | `shared/islands/index.ts` |
| `shared-islands` | `shared/islands/` | its own folder, npm |
| `shared-ui-build` | `shared/ui-build/` | its own folder, `shared/ui/index.ts` as types, npm |
| `shared-admin-envelope` | `shared/admin-envelope/` | its own folder, Node built-ins **(planned folder)** |
| `shared-host-pin` | `shared/host-pin/` | its own folder, Node built-ins |
| `deployment-preflight` | `deployment/preflight/` | its own folder, `deployment/edge/caddyfile.ts`, `shared/host-pin/index.ts`, the `yaml` package, Node built-ins |
| `tooling` | tests, the tooling set, config files | anything |

A domain may not import the Node I/O built-ins named in that file: `fs`, `net`, `http`, `https`, `http2`, `dgram`, `dns`, `tls`, `child_process`, `worker_threads` (`domain-no-io-builtins`). Adapters are built in the process composition root (`interfaces/http/compose.ts` for web).

## One adapter per SDK

| SDK | Adapter folder |
| --- | --- |
| `pg` | `infrastructure/postgres/` |
| `undici` | `infrastructure/net-guard/` |
| `@atproto/oauth-client-node` | `infrastructure/pds/` |
| `@atproto/api` | `infrastructure/pds/` |
| `@aws-sdk/client-s3` | `infrastructure/storage/` **(planned)** |
| `age-encryption` | `infrastructure/seal/` |
| `@atproto/lex*` | `shared/lexicons/` |
| `matrix-js-sdk` | `apps/chat/matrix/` **(planned)** |

An island (`*.island.tsx`) may import `shared/ui`, `shared/islands` through its index, type-only modules, and `react/jsx-runtime`. That list is `ISLAND_NPM_MODULES` in the same cruiser file ([ADR 0015](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0015-web-framework-glue.md)).
