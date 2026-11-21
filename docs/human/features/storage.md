# Storage

One object store holds blobs. Today the PDS uses it for members' blobs. Picture uploads keep drafts there, and the media process serves signed preview links from it.

## Route

There is no web route. The store is the `objects` service in the compose files, SeaweedFS with its S3 gateway ([ADR 0041](../decisions/0041-object-store.md), [ADR 0050](../decisions/0050-object-store-admin-through-its-shell.md)). The image is [`deployment/images/objects.Dockerfile`](../../../deployment/images/objects.Dockerfile).

## Operation

The client is [`infrastructure/storage/object-store.ts`](../../../infrastructure/storage/object-store.ts): `createObjectStore` signs each call with `aws4fetch` 1.0.20 and sends it through net-guard's `object-store` policy. [`interfaces/web/src/lib/server/compose.ts`](../../../interfaces/web/src/lib/server/compose.ts) calls it for the `drafts` store, and [`interfaces/media/compose.ts`](../../../interfaces/media/compose.ts) calls it for reads. Picture uploads keep drafts there, and the media process serves signed preview links from it.

## Domain rules

None. The store has no product rules of its own. A profile or a card names a blob by CID; the record rules live in [profile and cards](profile-and-cards.md).

## Adapter

The PDS is the caller that runs today. In the compose files its blob store is the bucket `unset-pds` (`PDS_BLOBSTORE_S3_BUCKET`, `PDS_BLOBSTORE_S3_ENDPOINT` and the matching S3 settings). It reaches the store on the network `objects_pds`, which only the PDS and `objects` share. Since P2.21a web is wired to the store too, as the identity `web` on members' drafts only (`unset-private/drafts/`), on the network `objects_web`, which only web and `objects` share; its secret is `objects_web` (runbook `dev-stack-secrets.md`).

[`deployment/preflight/objects-buckets.ts`](../../../deployment/preflight/objects-buckets.ts) creates two buckets, `unset-pds` and `unset-private`, through the store's own shell. The one secret is `objects_s3`. It holds no admin identity (ADR 0050).

`unset-private` is the drafts bucket. It waits for the later media work (Phase 2 and Phase 4). The `web` service joins `db`, `app` and `web_egress`, and `pds_admin` on the source stacks.

## Tables and grants

None.

## Tests

[`infrastructure/storage/object-store.test.ts`](../../../infrastructure/storage/object-store.test.ts), [`tests/integration/storage/object-store.test.ts`](../../../tests/integration/storage/object-store.test.ts), [`pds-key.test.ts`](../../../tests/integration/storage/pds-key.test.ts) (the PDS key reaches only its own bucket) and [`pds-blobstore.image.test.ts`](../../../tests/integration/storage/pds-blobstore.image.test.ts).

## When it is off or replaced

With the store down, the PDS cannot store or serve blobs, avatars included, and picture uploads cannot keep a draft or serve its preview.

A production store is not configured yet. The client and the PDS speak plain S3, so a later hosted endpoint would be a configuration change. That swap is unverified: no production configuration exists.
