---
title: Layers
weight: 2
---

Folder dependencies are an allowlist. `MATRIX` in `scripts/lint/.dependency-cruiser.cjs` is the definition: an edge no row lists fails as `not-in-allowed`. The `forbidden` rules restate the same boundaries so a failure names the one it breaks. The full checked table, including review-only rows, is [`docs/human/architecture.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md).

From outside a workspace, `infrastructure/<name>/` and `shared/<name>/` are reached only through `index.ts` (rule `infra-shared-via-index`, DC-2). A domain reaches another domain only through that domain's `index.ts` (`domain-cross-via-index`).

## Folders in the tree

| Layer | Present | Named, no folder |
| --- | --- | --- |
| `apps/` | `web` | `admin`, `chat` **(planned)**; `pds` **(planned, [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md))** |
| `interfaces/` | `http`, `admin`, `api`, `indexer`, `media`, `review` | `pds-admin`, `chat-admin` **(planned)** |
| `domains/` | `identity` | `content`, `social`, `feed`, `messaging`, `moderation`, `privacy` **(planned)** |
| `infrastructure/` | `postgres`, `pds`, `net-guard`, `seal`, `audit`, `session` | `tap`, `matrix`, `storage`, `arachnid`, `email` **(planned)** |
| `shared/` | `config`, `errors`, `host-pin`, `http`, `islands`, `lexicons`, `log`, `ui`, `ui-build` | `admin-envelope` **(planned)** |
| `deployment/` | `edge`, `images`, `postgres`, `preflight`, `env`, the two compose files | `pds` **(planned, ADR 0027)** |

`apps/web` is UI. It holds no product rules and no database access (`app-only-shared`). `interfaces/http` is the only interface with routes beyond `GET /health`. `domains/identity` is the only product-rule package. `infrastructure/session` holds the browser session store and does not import the Postgres driver; `interfaces/http/compose.ts` passes the pool in.

## Allowlist

`from` is the importing folder. "May reach" is that row of `MATRIX`, narrowed by the forbidden rule named in the last column where one changes the outcome. npm and Node built-ins are abbreviated.

| Row | From | May reach | Narrowed by |
| --- | --- | --- | --- |
| app | `apps/<name>/` | itself, `shared/`, npm | `no-app-to-app`, `app-only-shared` |
| interface | `interfaces/<name>/` except the two admin services | itself, `domains/`, `infrastructure/`, `shared/`, Node, npm | `no-interface-to-interface` |
| interface-http-render | `interfaces/http/` | `apps/web/render.tsx` | `app-render-entry-only` |
| interface-http-render-build | `interfaces/http/web/render-entry.ts` | `@unset/apps-web/server` | the one unresolved import, until that build exists |
| interface-admin-render | `interfaces/admin/` | `apps/admin/render.tsx` | `apps/admin` is **(planned)** |
| admin-service | `interfaces/pds-admin/`, `interfaces/chat-admin/` | itself, `shared/admin-envelope/`, Node built-ins | both folders **(planned)**; `admin-services-zero-deps` |
| domain | `domains/<name>/` | itself, another domain's `index.ts`, `shared/errors/`, `shared/lexicons/`, type-only `shared/config/` | `domain-pure`, `domain-no-io-builtins` (no `fs`, `net`, `http`, `https`, `http2`, `dgram`, `dns`, `tls`, `child_process`, `worker_threads`) |
| infrastructure | `infrastructure/<name>/` except net-guard | itself, `net-guard/`, `seal/`, `domains/`, `shared/`, Node, npm | `infrastructure-not-entry` |
| net-guard | `infrastructure/net-guard/` | itself, `undici`, Node | `net-guard-leaf` |
| shared | `shared/` except the leaf folders below | `shared/`, Node, npm | `shared-leaf` |
| shared-lexicons-scripts | `shared/lexicons/scripts/` | `shared/lexicons/`, npm, and `fs`, `path`, `os`, `url`, `child_process` | `lexicon-scripts-not-imported` |
| shared-ui-lexicons | `shared/ui/`, `shared/lexicons/` | itself, npm | |
| shared-ui-islands | `shared/ui/` | `shared/islands/index.ts` | |
| shared-islands | `shared/islands/` | itself, npm | no Node built-in on this row |
| shared-ui-build | `shared/ui-build/` | itself, type-only `shared/ui/index.ts`, npm | |
| shared-admin-envelope | `shared/admin-envelope/` | itself, Node | folder **(planned)**; `allowlist-zero-deps` |
| shared-host-pin | `shared/host-pin/` | itself, Node | |
| deployment-preflight | `deployment/preflight/` | itself, `deployment/edge/caddyfile.ts`, `shared/host-pin/index.ts`, the `yaml` package, Node | `edge-not-preflight` is one way: the edge never imports the preflight |
| tooling | `scripts/`, `tests/`, `*.test.ts`, root config, an app's `vite.config.ts` | anything | `no-product-imports-tooling-set`: product code never imports this set |

An app's `vite.config.ts` may also import Node built-ins and `scripts/ui/css-scope.ts` (`app-build-config-imports`). Nothing imports that file. A `*.island.tsx` may import `shared/ui/`, `shared/islands/` and `react/jsx-runtime` (`island-import-boundary`). Each vendor SDK in `SDK_ADAPTERS` has one adapter folder (`vendor-sdk-one-adapter`): `pg` in `infrastructure/postgres/`, `undici` in `infrastructure/net-guard/`, `@atproto/oauth-client-node` and `@atproto/api` in `infrastructure/pds/`, `age-encryption` in `infrastructure/seal/`, `@atproto/lex*` in `shared/lexicons/`. `@aws-sdk/client-s3` is reserved for `infrastructure/storage/` and `matrix-js-sdk` for `apps/chat/matrix/` **(planned)**.

Adapters are built in the process's `compose.ts` (`interfaces/http/compose.ts` is the one that wires Postgres, net-guard, the PDS client, the sealer and the session store). `main.ts` imports `compose.ts` and does not import `infrastructure/`.
