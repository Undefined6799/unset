---
id: storage
type: area
status: current
areas: ["[[storage]]"]
summary: "Hub for infrastructure/storage: the private object store (S3 API, SeaweedFS in-stack) behind a thin contract, ADR 0041."
code: [infrastructure/storage/index.ts, infrastructure/storage/object-store.ts]
sources: []
importance: high
related: ["[[net-guard]]", "[[pds]]", "[[tests]]"]
replaced_by: null
tags: [area, storage]
checked: 2026-11-15
---
# storage

**What it owns.** `createObjectStore`, the adapter for the private object store (ADR 0041, book P2.18s): `put` (with
optional tags), `setTags`, `get` (missing reads as `bytes: null`), `list` and `deletePrefix`. Every failure is
`{ ok: false, code: "objects.unavailable" }` and never carries the key, because keys hold raw DIDs (SE-7). A key
outside the alphabet `[A-Za-z0-9._:-]` with `/` separators, or with a `.` or `..` segment, throws a TypeError: that is
a caller bug, not an expected failure.

**Egress.** The adapter opens no connection. The composition root passes net-guard's `guardedFetch` for the
`objectStore(OBJECT_STORE_URL)` policy (P2.18k), so only that one private origin is reachable. Calls are GET, PUT and
POST; delete is the multi-object `POST ?delete`, so net-guard never needs DELETE.

**Dependency: aws4fetch 1.0.20 (MIT, no dependencies).** It only signs (SigV4) and returns a `Request`;
`AwsClient.sign()` does not read the AWS environment, config files or instance metadata
(`node_modules/aws4fetch/dist/aws4fetch.esm.mjs`). Chosen over `@aws-sdk/client-s3`, which pulls dozens of packages
and its own credential chain and HTTP stack around net-guard. It sends `UNSIGNED-PAYLOAD` for s3 unless the
`x-amz-content-sha256` header is set, so the adapter sets the body's sha256 itself and the payload is signed.

**Pitfalls.**
- **Fresh SeaweedFS is slow on its first write** (it allocates volumes, seconds). The integration test pays that in
  `beforeAll` with a warm-up object.
- **Content-MD5 is required** on the multi-object delete, and the 200 response can still hold per-key `<Error>`
  entries; the adapter treats any as unavailable.
- **SeaweedFS `List` is bucket-wide**, whatever the prefix in `s3.json`. Read and write scope by prefix and were
  checked to deny other prefixes, multi-delete keys included.
- **net-guard caps a request body at 1 MiB.** Fine for drafts' images; video (Phase 4) needs a bigger cap or streaming.

**Tests.** `tests/integration/storage/object-store.test.ts` against a real SeaweedFS from `tests/support/objects.ts`,
with per-process keys as the stack scopes them.
