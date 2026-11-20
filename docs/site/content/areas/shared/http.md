---
title: http
weight: 4
---

Pieces the web process and the indexer share. Package `@unset/shared-http`. The web server is [web](../../interfaces/web/). This folder has no server, no CSRF gate and no route table. The Hono server and the CSRF gate were deleted in P1.20k (`shared/http/index.ts`).

## Owns

Exports are `shared/http/index.ts`.

| File | What it holds |
| --- | --- |
| `shared/http/config.ts` | `hostAllowed`, `httpKitConfig`. |
| `shared/http/headers.ts` | `SECURITY_HEADERS`. |
| `shared/http/health.ts` | `createHealth`. |
| `shared/http/shutdown.ts` | `drain`, `exitOnSignals`. |
| `shared/http/clientIp.ts` | `ClientIp`. |
| `shared/http/trustedProxy.ts` | `createClientIpResolver`. |
| `shared/http/returnPath.ts` | `safeReturnPath`, the only way a redirect target is chosen from input. |
| `shared/http/limits/rateLimit.ts` | Token buckets. |
| `shared/http/limits/policy.ts` | `definePolicies`. |

On this tree the product importers are `interfaces/web` and `interfaces/indexer` (`exitOnSignals` in `interfaces/indexer/main.ts`). `apps/` does not import it. Who else may import it is the [shared](../) table.
