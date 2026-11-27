---
title: net-guard
weight: 2
---

The egress classifier. Package `@unset/infrastructure-net-guard`. Plan §2 rule 13, as the folder comment states it: caller-influenced outbound HTTP goes through here. `scripts/guards/egress.ts` scans product trees for a dynamic `fetch`, the raw-client specifiers in `RAW_CLIENT`, and `new WebSocket` / `new EventSource`. `exempt` skips `infrastructure/net-guard/` and test files. `EGRESS_FILE_EXEMPTIONS` names the path `interfaces/pds-admin/pds.mjs`. The file says the scan is lexical.

## Owns

| Module | What it holds |
| --- | --- |
| `infrastructure/net-guard/src/ranges.ts` | `RANGES`, the address classes `classifyAddress` uses. |
| `infrastructure/net-guard/src/classify.ts` | `classifyAddress`, `isInternalName`, `normaliseHost`. |
| `infrastructure/net-guard/src/resolve.ts` | `resolveVetted`, `pinnedLookup`, `NetGuardError`. |
| `infrastructure/net-guard/src/dns.ts` | `resolveTxt` on `node:dns/promises` `Resolver`. |
| `infrastructure/net-guard/src/policies.ts` | The policies below. |
| `infrastructure/net-guard/src/request.ts` | `createNetGuard`. |
| `infrastructure/net-guard/src/libraryFetch.ts` | `libraryFetch`, `guardedFetch` and `objectStoreFetch`, a `fetch` shape over the guard. `objectStoreFetch` uses `objectStore` and caps the answer at `OBJECT_STORE_BYTES`. |
| `infrastructure/net-guard/src/remote.fake.ts` | Test double. Not exported from `index.ts`. |

Policies `policies.ts` exports. A policy with no `requestBytes` sends a request body of at most `DEFAULT_REQUEST_BYTES` (1 MiB). In this file only `atprotoBlobUpload` and `objectStore` set 5 MiB, and `review` sets 66 MiB. `requestCap` throws `RangeError` when the cap is not an integer in (0, 66 MiB]. [ADR 0076](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0076-image-uploads-up-to-64-mib.md) is the 66 MiB ceiling; [ADR 0088](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0088-picture-main-version-webp-5mb.md) is the 5 MiB picture hops.

| Export | Value |
| --- | --- |
| `DEFAULT_REQUEST_BYTES` | 1 MiB (`1024 * 1024`). |
| `REQUEST_BODY_CEILING` | 66 MiB (`66 * 1024 * 1024`). |
| `plc` | `kind: "fixed"`, host `plc.directory`. No `requestBytes`. |
| `atproto` | `kind: "public"`. No `requestBytes`. |
| `PICTURE_HOP_BYTES` | 5 MiB (`5 * 1024 * 1024`). |
| `atprotoBlobUpload` | `kind: "public"`, name `atproto-upload`, `requestBytes: PICTURE_HOP_BYTES`. `libraryFetch` uses it only for `POST` with pathname `/xrpc/com.atproto.repo.uploadBlob`. |
| `requestCap(policy)` | `policy.requestBytes ?? DEFAULT_REQUEST_BYTES`. `RangeError` outside (0, 66 MiB]. |
| `internalPolicy(name, origins, requestBytes?)` | Builds a `kind: "internal"` policy from exact http(s) origins. An empty list or a bad origin throws `TypeError`. A `requestBytes` outside (0, 66 MiB] throws `RangeError`. |
| `localPlc` | `internalPolicy("plc", ["http://plc:2582"])`. |
| `OBJECT_STORE_BYTES` | `PICTURE_HOP_BYTES`. |
| `objectStore(origin)` | `internalPolicy("object-store", [origin], OBJECT_STORE_BYTES)`, one exact internal origin. |
| `review(origin)` | `internalPolicy("review", [origin], REQUEST_BODY_CEILING)`. |
| `pdsAdmin(origin)` | `internalPolicy("pds-admin", [origin])`. No `requestBytes`. |

`index.ts` re-exports every row except `PICTURE_HOP_BYTES`, `requestCap` and `localPlc`, plus the `Policy` type.

`localPlc` is a dead export, [ADR 0023](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0023-local-pds-publishes-to-shared-plc.md), decided (0001 log), acceptance pending.

`checkRequest` in `request.ts` allows PUT only on a `kind: "internal"` policy and GET and POST on any; any other method throws `TypeError`.

`request.ts` refuses status 301, 302, 303, 307 and 308 with `egress.redirect`. `resolveVetted` classifies every answer (`classifyAddress`) and `pinnedLookup` returns only the addresses it was given. `infrastructure/postgres/config.ts` calls `classifyAddress` for `PG_SSLMODE=disable`.

`NetGuardSettings.onRequest` is typed so the event carries the policy name, status, timing and byte count. The type has no host, URL or address field.

## May import

The [`net-guard` row](../), not the `infrastructure` row. No `shared/`, no `domains/`, no `seal`.

Declared in `infrastructure/net-guard/package.json`: `undici` 8.12.2. `request.ts` imports `Agent`, `buildConnector` and `request` from it.

`vendor-sdk-one-adapter` confines `undici` to this folder. `net-guard-leaf` is the same set for non-test files, plus `fast-check` and `vitest` for a `*.test.ts`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/net-guard/index.ts` |
| Composition | `createNetGuard` in `interfaces/web/src/lib/server/compose.ts` |

No `main.ts` and no Compose service for this package. `libraryFetch` is what `infrastructure/pds` passes the OAuth client (`oauth-client.ts` option `fetch`). `objectStoreFetch` is what `interfaces/web/src/lib/server/compose.ts` and `interfaces/media/compose.ts` pass the object store.

## Data

No schema, role or table. `infrastructure/postgres/config.ts` is the other production caller of `classifyAddress`, for whether `PG_SSLMODE=disable` may name that host.
