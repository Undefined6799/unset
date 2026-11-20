---
title: web
weight: 1
---

The web server for unset.sh. Package `@unset/interfaces-web`. Compose service `web` still sets `UNSET_SERVICE: http`. The image starts at `node interfaces/web/server.ts` (`deployment/images/node-app.Dockerfile`).

Routes and limits are on [Endpoints](/endpoints/web/). The request gate is on [Security model](/architecture/security-model/). [ADR 0054](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0054-web-process-on-sveltekit.md), [ADR 0055](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0055-shadcn-svelte-and-one-theme-file.md) and [ADR 0056](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0056-web-boundary-by-file-kind.md) are the decisions.

## Owns

Public pages, sign-in, the signed-in member's page, and the adapters those routes call. `interfaces/web/src/lib/server/compose.ts` is the only file here that builds adapters. `startServices` runs from the SvelteKit `init` hook, before `server.ts` listens. It wires the `web` pools, the sealer, net-guard, the identity network, the OAuth client, the session store and the account repository.

`interfaces/web/server.ts` is the adapter-node custom server. Every response, files included, gets the host check, the security headers from `shared/http`, one log line, listen and the drain. Settings load first and exit 78 when invalid.

`interfaces/web/src/hooks.server.ts` is the request gate. Its header lists the order: the route's policy (none is a refusal), test routes, form-only bodies, the body size, the client address and its limit, the session and the member limit, the route under its deadline, then the group's CSP. SvelteKit's Origin check runs on form posts before this hook. Any other body is 415. `tests/integration/web/csrf-coverage.test.ts` covers that.

| Path | What it holds |
| --- | --- |
| `interfaces/web/src/lib/server/policy.ts` | `definePolicy`. Session modes are `required`, `writes`, `onboarding` and `optional`. |
| `interfaces/web/src/lib/server/route-table.ts` | Reads each route folder's `policy.ts`. |
| `interfaces/web/src/lib/server/app-gate.ts` | After the session: onboarding, then a confirmed email. |
| `interfaces/web/src/lib/server/session.ts` | Cookie `__Host-sid`. |
| `interfaces/web/src/lib/server/limits.ts` | Rate-limit names. Which route uses which is on Endpoints. |
| `interfaces/web/src/lib/server/config.ts` | Typed settings for this process. |
| `interfaces/web/src/routes/` | One folder per route, each with a `policy.ts`. |

Screens are [web](../../apps/web/). A server file may import a domain or infrastructure. A `.svelte` file or a universal `+page.ts` may not (`svelte-screens-no-core`). A route does not import `infrastructure/postgres` (`web-routes-no-postgres`). `GET /health` is `interfaces/web/src/routes/health/` (`probe: true`); the body is `shared/http/health.ts`.
