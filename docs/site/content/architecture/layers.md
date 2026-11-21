---
title: Layers
weight: 2
---

Folder dependencies are an allowlist. `MATRIX` in `scripts/lint/.dependency-cruiser.cjs` is the definition: an edge no row lists fails as `not-in-allowed`. The `forbidden` rules restate the same boundaries so a failure names the one it breaks. The full checked table is [`docs/human/architecture.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md).

From outside a workspace, `infrastructure/<name>/` and `shared/<name>/` are reached only through `index.ts` (`infra-shared-via-index`, DC-2). A domain reaches another domain only through that domain's `index.ts` (`domain-cross-via-index`). From `apps/`, `interfaces/`, `infrastructure/` or `shared/`, a domain is reached only through its `index.ts` or a file its `package.json` `exports` names (`domain-via-exports`, DC-2).

## Folders in the tree

| Layer | Present |
| --- | --- |
| `apps/` | `web` |
| `interfaces/` | `web`, `indexer`, `pds-admin` |
| `domains/` | `identity`, `profile` |
| `infrastructure/` | `postgres`, `pds`, `net-guard`, `seal`, `audit`, `session`, `storage`, `firehose` |
| `shared/` | `config`, `errors`, `host-pin`, `http`, `lexicons`, `log`, `ui`, `ui-build`, `admin-envelope`, `safe-href` |
| `deployment/` | `edge`, `images`, `pds`, `postgres`, `preflight`, `env`, `sigstore`, the compose files |

Decision 34 ([`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md)): a folder appears when its first code lands. `apps/web` holds screens only (`app-only-shared`). `interfaces/web` is the web server. `domains/identity` and `domains/profile` are the product-rule packages. `infrastructure/session` does not import the Postgres driver; `interfaces/web/src/lib/server/compose.ts` and `interfaces/indexer/compose.ts` each pass a pool in.

## Allowlist

`from` is the importing folder. npm and Node built-ins are abbreviated. The last column is the forbidden rule that narrows the row.

| Row | From | May reach | Narrowed by |
| --- | --- | --- | --- |
| app | `apps/<name>/` | itself, `shared/`, npm | `no-app-to-app`, `app-only-shared` |
| interface | `interfaces/<name>/` except `ADMIN_SERVICES` | itself, `domains/`, `infrastructure/`, `shared/`, Node, npm | `no-interface-to-interface`, `domain-via-exports` |
| interface-web-sveltekit | `interfaces/web/` | `$app/…` | unresolved on purpose |
| interface-web-components | `interfaces/web/` | `apps/web/lib/`, `app.css`, `theme.css`, `legal/*.md` | `web-components-only` |
| interface-web-build | `interfaces/web/server.ts` | `#kit/handler`, `#kit/manifest` | unresolved on purpose |
| interface-admin-render | `interfaces/admin/` | `apps/admin/render.tsx` | `app-render-entry-only` |
| admin-service | `interfaces/pds-admin/`, `interfaces/chat-admin/` | itself, `shared/admin-envelope/`, Node | `admin-services-zero-deps` |
| domain | `domains/<name>/` | itself, another domain's `index.ts`, `shared/errors/`, `shared/lexicons/`, type-only `shared/config/` | `domain-pure`, `domain-no-io-builtins` |
| infrastructure | `infrastructure/<name>/` except net-guard | itself, `net-guard/`, `seal/`, `domains/`, `shared/`, Node, npm | `infrastructure-not-entry` |
| net-guard | `infrastructure/net-guard/` | itself, `undici`, Node | `net-guard-leaf` |
| shared | `shared/` except `LEAF_SHARED` | `shared/`, Node, npm | `shared-leaf` |
| shared-lexicons-scripts | `shared/lexicons/scripts/` | `shared/lexicons/`, npm, `fs`, `path`, `os`, `url`, `child_process` | `lexicon-scripts-not-imported` |
| shared-ui-lexicons | `shared/ui/`, `shared/lexicons/` | itself, npm | |
| shared-ui-safe-href | `shared/ui/` | `shared/safe-href/index.ts` | |
| shared-safe-href | `shared/safe-href/` | itself | no npm, no Node |
| shared-ui-build | `shared/ui-build/` | itself, type-only `shared/ui/index.ts`, npm | |
| shared-admin-envelope | `shared/admin-envelope/` | itself, Node | `allowlist-zero-deps` |
| shared-host-pin | `shared/host-pin/` | itself, Node | |
| deployment-preflight | `deployment/preflight/` | itself, `deployment/edge/adapted.ts`, `adapted-rules.ts`, `shared/host-pin/index.ts`, `yaml`, Node | `edge-not-preflight` |
| tooling | `scripts/`, `tests/`, `*.test.ts`, root config, an app `vite.config.ts` | anything | `no-product-imports-tooling-set` |

`LEAF_SHARED` is `ui`, `ui-build`, `lexicons`, `admin-envelope`, `host-pin` and `safe-href`. In the web process only server files reach a domain or infrastructure (`svelte-screens-no-core`). `vendor-sdk-one-adapter` allows each SDK in `SDK_ADAPTERS` on one path. On this tree those paths include `infrastructure/postgres/`, `net-guard/`, `pds/`, `seal/`, `storage/` and `firehose/`, and `shared/lexicons/`. The same list names `apps/chat/matrix/` for `matrix-js-sdk`; that folder is not on the tree.

Adapters are built in a process's `compose.ts`. `interfaces/web/server.ts` does not import `infrastructure/`.
