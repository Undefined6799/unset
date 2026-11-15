# 0041 — One S3-compatible object store for app media and PDS blobs

Status: Proposed, awaiting Alex. Alex asked for the plan on 2026-10-30 ("next I want to plan the integration of s3
storage to the app", thread cmsg_01GKYqaAGu4Vob5JHVyDmG7AWidTwT5ar1fTfFx5Pa8p1M; plan doc
https://claude.ai/artifact/WT8mwzPBcEemWBxjFDtzR1) and for the build on 2026-11-15 20:43:46Z: "also implement s3
storage for both, the pds and the users." (cmsg_01GKYqaAGu4Vob5JHVyDmG7AXPfR9PqJMu9cGV8YU7RoH2). Acceptance is his typed
line naming this record's commit. Once accepted it settles book question P2-A8 (the store's server) and replaces
the plan's "the dev PDS keeps blobs on disk" (book P1.29i) for the stacks that run the store. Production's store and
provider stay P5.01's decision (Q3); this record does not choose one.

## Context
The plan already needs an object store (§5.8: a `drafts` store with per-DID prefixes, renditions in `media`
storage, legal holds), and book P2.18 adds one to the dev stack. Nothing stores bytes yet. The PDS keeps its blobs on
the data volume. Alex wants both the app's member media and the PDS's blobs in S3.

Facts read for this record (rule DO-3), 2026-10-30 and 2026-11-15:
- SeaweedFS is Apache-2.0 (github.com/seaweedfs/seaweedfs). Its S3 API wiki lists object tagging, lifecycle, object
  lock, versioning and SSE. Version 4.53, image `chrislusf/seaweedfs:4.53@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0`
  (published 2026-11-08, cosign signature tags beside it), run locally: per-identity actions scoped to a bucket and key
  prefix (`Write:unset-private/drafts/*`) were refused outside the prefix, for PUT, GET, list and each key of a
  multi-object delete; tags, ranged GET and list v2 behaved as S3 does.
- Garage's S3 compatibility page marks object tagging and object lock missing, so the tag-filtered lifecycle backstop
  (P2.18, P5.01) cannot run on it. MinIO's community images stopped in October 2025 and its repository is archived.
- `aws4fetch` 1.0.20 (MIT, no dependencies, WebCrypto): `AwsClient.sign()` returns a signed `Request` and opens no
  connection (`dist/aws4fetch.esm.mjs:42`), so the request can be sent through net-guard. `@aws-sdk/client-s3`
  3.1160.0 brings the `@smithy` tree and a Node credential chain that reads the environment, `~/.aws` and instance
  metadata, which is why P1.29i refused the PDS's S3 settings.
- The PDS's S3 blobstore (`@atproto/aws` `s3.ts` at the pinned PDS source 5d6febd) stores `blocks/<did>/<cid>`,
  `tmp/<did>/<key>` and `quarantine/<did>/<cid>`, takes an explicit endpoint, region, path-style flag and key pair
  (`pds/src/config/config.ts:68-90`), and refuses a disk and an S3 store set together. Its disk store keeps
  `<location>/<did>/<cid>`.

## Decision
1. **One store service, `objects`,** runs SeaweedFS 4.53 by digest, mirrored like every upstream image (P2.26b), in
   the dev stack (staging) and the local stack. It publishes no port and sits on internal networks only, one per
   client process. Its data is a named volume.
2. **Two buckets, never shared.** `unset-private` holds what is ours: `drafts/<did>/…`, `media/<did>/…`,
   `legal-hold/<holdId>/…` (plan §5.8, book P2.18 key convention). `unset-pds` is the PDS's blobstore and nothing
   else. No bucket is public, and no browser ever reaches the store: no presigned S3 URL is ever sent; members' media
   reaches browsers only through `media` (signed draft URLs, P2.19; the media proxy, P3.09).
3. **One key per process, least privilege, enforced by the store** and proven by a denial test per key: `web`
   read-write and tagging on `unset-private/drafts/*`; `media` read-only on `unset-private/drafts/*` and `media/*`;
   the PDS read-write on `unset-pds` only; later processes get their own key in the step that adds them. Keys are
   secrets in the dev-stack secret files, never in the checkout or a log. Only the store's one-shot setup holds the
   admin identity, which creates the buckets.
4. **The app's client is `infrastructure/storage/`,** signing with `aws4fetch` 1.0.20 (exact pin) and sending every
   request through net-guard's `object-store` policy (P2.18k: one exact internal origin, private answers, PUT allowed
   on internal policies only, deletes through the multi-object POST). Path-style URLs and a fixed region, so nothing
   reads the AWS environment, a config file or instance metadata. Its contract is the book's: `put`, `get`, `setTags`,
   `deletePrefix`, `list`, each with a 10 s timeout and typed results, never a throw. Object keys hold raw DIDs, so
   storage errors log the code only, never the key (SE-7).
5. **The PDS stores its blobs in `unset-pds`** through its own S3 client, configured with `PDS_BLOBSTORE_S3_BUCKET`,
   `_ENDPOINT` (the store's internal origin), `_REGION`, `_FORCE_PATH_STYLE=true` and its explicit key pair; the disk
   setting is removed. Preflight refuses any other endpoint, a missing region or key, or a disk and S3 store set
   together. The local stack's token reader (P1.29i) accepts exactly this shape and still refuses any other S3
   setting. Existing blobs on staging are copied from `<location>/<did>/<cid>` to `blocks/<did>/<cid>` before the
   switch, in a runbook step Alex runs.
6. **Encryption.** None at the application layer while the store runs in our own stack on our own host. Private
   prefixes (`drafts/`, `legal-hold/` is already sealed) are encrypted by `infrastructure/seal` before they are ever
   written to a third-party bucket; that is built only if P5.01 picks a provider bucket for the primary store.
7. **Erasure and export.** `drafts/<did>/` and `media/<did>/` join the erasure registry and P3.07's outbox; the
   PDS's own account deletion removes `blocks/<did>/` as it removes the folder today.

## Alternatives
- **Garage (AGPL-3.0).** No object tagging or object lock. Rejected.
- **MinIO.** Archived community edition, no images. Rejected.
- **`@aws-sdk/client-s3` in the app.** Full featured, but a large tree and the credential chain P1.29i refused.
  Rejected; a ~120-line SigV4 signer of our own stays the fallback if `aws4fetch` stops being maintained.
- **PDS blobs stay on disk** (the 2026-10-30 plan's recommendation). Simpler and the blobs are public anyway, but Alex
  asked for S3 for both on 2026-11-15.
- **One bucket for everything.** Fewer keys, but a PDS key could then reach members' drafts. Rejected.

## Consequences
- A new service, image and volume in dev and local; the mirror and lock gain an entry (Alex runs the mirror workflow).
- The PDS gains a network path to `objects` and loses its blob folder; a store outage now also stops PDS blob reads
  and writes (records and sign-in keep working). Backups (P5.04) and the restore drill must cover the store's volume.
- The store's `List` action is bucket-wide: a key that may list `unset-private` sees every key name, DIDs included.
  Only `web` lists, and only under its own prefixes; no other process gets `List`.
- One more dependency (`aws4fetch`) on the server, recorded in the dependency notes.

## Compliance
Book steps P2.18k, P2.18s (store and adapter), P2.18p (PDS blobstore), P2.18 and P2.19; their named tests; preflight
checks for the PDS's S3 settings; the RoPA rows for draft media and renditions (P2.18).
