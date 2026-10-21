---
title: net-guard
weight: 2
---

The egress classifier. Package `@unset/infrastructure-net-guard`. Plan §2 rule 13, as the folder comment states it: caller-influenced outbound HTTP goes through here. `scripts/guards/egress.ts` scans product trees for a dynamic `fetch`, a raw socket client and `new WebSocket` / `new EventSource`. The scan skips `infrastructure/net-guard/` and `interfaces/pds-admin/pds.mjs` (`EGRESS_FILE_EXEMPTIONS`). The file says the scan is lexical.

## Owns

| Module | What it holds |
| --- | --- |
| `infrastructure/net-guard/src/ranges.ts` | `RANGES`, the address classes `classifyAddress` uses. |
| `infrastructure/net-guard/src/classify.ts` | `classifyAddress`, `isInternalName`, `normaliseHost`. |
| `infrastructure/net-guard/src/resolve.ts` | `resolveVetted`, `pinnedLookup`, `NetGuardError`. |
| `infrastructure/net-guard/src/dns.ts` | `resolveTxt` on `node:dns/promises` `Resolver`. |
| `infrastructure/net-guard/src/policies.ts` | The policies below. |
| `infrastructure/net-guard/src/request.ts` | `createNetGuard`. |
| `infrastructure/net-guard/src/libraryFetch.ts` | `libraryFetch` and `guardedFetch`, a `fetch` shape over the guard. |
| `infrastructure/net-guard/src/remote.fake.ts` | Test double. Not exported from `index.ts`. |

Policies `policies.ts` exports:

| Export | Value |
| --- | --- |
| `plc` | `kind: "fixed"`, host `plc.directory` |
| `atproto` | `kind: "public"` |
| `localPlc` | `internalPolicy("plc", ["http://plc:2582"])` |
| `internalPolicy` | Builds a `kind: "internal"` policy from exact http(s) origins |

[ADR 0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md) says the local PLC pieces, this policy included, are dead and removed in their own cleanup. The export and `infrastructure/net-guard/src/request.test.ts` are still on the tree. `infrastructure/pds/identity-network.ts` calls `guard.request` with `plc` or `atproto`, not `localPlc`.

`request.ts` refuses status 301, 302, 303, 307 and 308 with `egress.redirect`. `resolveVetted` classifies every answer (`classifyAddress`) and `pinnedLookup` returns only the addresses it was given. `infrastructure/postgres/config.ts` calls `classifyAddress` for `PG_SSLMODE=disable`.

`NetGuardSettings.onRequest` is typed so the event carries the policy name, status, timing and byte count. The type has no host, URL or address field.

## May import

The [`net-guard` row](../), not the `infrastructure` row. No `shared/`, no `domains/`, no `seal`.

Declared in `infrastructure/net-guard/package.json`: `undici` 8.11.2. `request.ts` imports `Agent`, `buildConnector` and `request` from it.

`vendor-sdk-one-adapter` confines `undici` to this folder. `net-guard-leaf` is the same set for non-test files, plus `fast-check` and `vitest` for a `*.test.ts`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/net-guard/index.ts` |
| Composition | `createNetGuard` in `interfaces/http/compose.ts` |

No `main.ts` and no Compose service for this package. `libraryFetch` is what `infrastructure/pds` passes the OAuth client (`oauth-client.ts` option `fetch`).

## Data

No schema, role or table. `infrastructure/postgres/config.ts` is the other production caller of `classifyAddress`, for whether `PG_SSLMODE=disable` may name that host.
