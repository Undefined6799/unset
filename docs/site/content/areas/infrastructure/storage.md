---
title: storage
weight: 7
---

The object-store adapter. Package `@unset/infrastructure-storage`. The store decision is [ADR 0041](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0041-object-store.md).

## Owns

`infrastructure/storage/object-store.ts` holds `createObjectStore`. `infrastructure/storage/index.ts` re-exports `createObjectStore`, `ObjectStore`, `ObjectStoreSettings` and `Tags`.

`ObjectStoreSettings` is `origin`, `bucket`, `keyId`, `secret` and `fetch` (`typeof fetch`). `createObjectStore` builds an `AwsClient` (`accessKeyId`, `secretAccessKey`, `service: "s3"`, `region: "us-east-1"`), signs with that client, and calls `settings.fetch` with the signed request. This file does not read `process.env` and does not call the global `fetch`. The object URL is `${origin}/${bucket}/${key}`.

A returned failure is `{ ok: false, code: "objects.unavailable" }`. That value has no key. A key or prefix outside the check throws `TypeError` before any request: `object key outside the allowed alphabet`, or `object prefix outside the allowed alphabet or without its trailing slash`.

A key matches `/^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)*$/`, and no segment is `.` or `..`. A prefix ends in `/`, and the text before that slash passes the key check.

| Method | Request | Success |
| --- | --- | --- |
| `put(key, bytes, contentType, tags?)` | `PUT`. Header `content-type`. When `tags` is present and not empty, header `x-amz-tagging` is the tag query string. | Status 200, `{ ok: true }`. |
| `setTags(key, tags)` | `PUT` `?tagging`. Tagging XML. Names and values are XML-escaped. | Status 200, `{ ok: true }`. |
| `get(key)` | `GET`. | 404 is `{ ok: true, bytes: null }`. 200 is `{ ok: true, bytes }` from `arrayBuffer`. A thrown body read is unavailable. |
| `list(prefix)` | `GET` with `list-type=2`, `prefix`, `max-keys=1000` (`BATCH`), and `continuation-token` while a page is truncated. | `{ ok: true, keys }` in page order. A page counts only as one whole `ListBucketResult` with `IsTruncated` `true` or `false`. Truncated with no token is unavailable. A listed key that fails the key check is unavailable. |
| `deletePrefix(prefix)` | Lists, then `POST` `?delete` in batches of 1000. Body `<Delete><Quiet>true</Quiet>…</Delete>`. Headers `content-md5` (MD5 of that XML, base64) and `content-type: application/xml`. | `{ ok: true, deleted }` is the listed key count when every batch is status 200, one whole `DeleteResult`, and the body contains no `<Error>`. |

Each signed call sets `x-amz-content-sha256` to the SHA-256 hex of the body, or of the empty string when there is no body. A thrown `sign`, `fetch` or body read is unavailable.

`objectStore` on [net-guard](../net-guard/) is `internalPolicy("object-store", [origin])` in `infrastructure/net-guard/src/policies.ts`, exported from `infrastructure/net-guard/index.ts`. This package does not import net-guard.

## May import

The [`infrastructure` row](../). This package reaches neither `net-guard` nor `seal` nor another infrastructure package.

Declared in `infrastructure/storage/package.json`: `aws4fetch` 1.0.20. `object-store.ts` imports `AwsClient` from it and `createHash` from `node:crypto`. The root `package.json` lists `aws4fetch` 1.0.20 under `dependencies`, not `devDependencies`: the integration test imports it, and the image's dev-dependency check would flag a dev entry for a package that ships at runtime.

`vendor-sdk-one-adapter` names `@aws-sdk/client-s3` for `infrastructure/storage/`. This package does not depend on `@aws-sdk/client-s3`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/storage/index.ts` |
| Factory | `createObjectStore` |

No `main.ts`, no CLI and no Compose service for this package. `interfaces/web/src/lib/server/compose.ts` calls `createObjectStore` for the `drafts` store, through net-guard, and `interfaces/media/compose.ts` calls it for reads. `infrastructure/storage/object-store.test.ts` passes a test `fetch`. `tests/integration/storage/object-store.test.ts` passes the platform `fetch`.

## Data

No schema, role or table. No SQL.
