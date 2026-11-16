# 0041 — One S3-compatible object store for app media and PDS blobs

Status: Accepted by Alex, 2026-11-15 22:06:23Z, against 843bfc4 ("accept ADR 0041 at 843bfc4", typed in the
storage thread, on the head the coordinator had verified). From here the record changes only to be marked superseded.
Alex asked for the plan on 2026-10-30 and for the build on 2026-11-15 ("also implement s3 storage for both, the pds
and the users.").
Once accepted it settles book question P2-A8 (the store's server) and replaces the plan's "the dev PDS keeps blobs on
disk" (book P1.29i) for the stacks that run the store. Production's store and provider stay P5.01's decision (Q3);
this record does not choose one.

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
- Garage's S3 compatibility page marks object tagging and object lock missing; P2.18 records a draft's state in object
  tags. Whether SeaweedFS runs a tag-filtered lifecycle rule is not verified, so the P2.18 sweeper, not a store rule,
  is what expires drafts. MinIO's community images stopped in October 2025 and its repository is archived.
- SeaweedFS deletes are not immediate. A delete marks the needle deleted; the master vacuums a volume only when its
  garbage ratio exceeds `-master.garbageThreshold` (default 0.3), checking every `-master.vacuumIntervalSeconds`
  (default 840) (`weed server -h`, 4.53). Vacuum writes a compacted copy of the volume and unlinks the old file; it
  does not overwrite the freed disk blocks.
- Tried on 4.53, 2026-11-15, with an incompressible object carrying a plaintext marker: without
  `-filer.encryptVolumeData` the marker is in the volume's `.dat` file after the S3 PUT; with it, the marker is in no
  file under the data folder, so the flag is honoured on the S3 write path. Each chunk is AES-256-GCM encrypted with its
  own random key held in the filer's metadata (wiki "Filer Data Encryption"). After a DELETE the marker stayed in the
  `.dat` file; `volume.vacuum -garbageThreshold 0` (under `lock`) removed it; a threshold above a volume's garbage
  ratio leaves that volume alone.
- The filer keeps deleted entries after the delete: its LevelDB store held the deleted key's name in its write-ahead
  log, and it persists a metadata change log under `/topics/.system/log/` (both seen on 4.53). A delete therefore does
  not destroy the chunk's cipher key, and the key names, which hold DIDs, outlive the object there.
- `aws4fetch` 1.0.20 (MIT, no dependencies, WebCrypto): `AwsClient.sign()` returns a signed `Request` and opens no
  connection (`dist/aws4fetch.esm.mjs:42`), so the request can be sent through net-guard. `@aws-sdk/client-s3`
  3.1160.0 brings the `@smithy` tree and a Node credential chain that reads the environment, `~/.aws` and instance
  metadata, which is why P1.29i refused the PDS's S3 settings.
- The PDS's S3 blobstore (`@atproto/aws` `s3.ts` at the pinned PDS source 5d6febd) stores `blocks/<did>/<cid>`,
  `tmp/<did>/<key>` and `quarantine/<did>/<cid>`, takes an explicit endpoint, region, path-style flag and key pair
  (`pds/src/config/config.ts:68-90`), and refuses a disk and an S3 store set together. Its disk store keeps
  `<location>/<did>/<cid>`.

## Decision
1. **One store service, `objects`,** runs SeaweedFS 4.53 by digest in the dev stack (staging) and the local stack.
   The image comes from a personal Docker Hub namespace, so its upstream signature is verified before it is mirrored
   or built on (P2.26b): the compose step pins the signing identity and checks it, and if the upstream signature
   cannot be verified that way, we build the image from the tagged source in our own pipeline instead. It publishes no port and sits on internal networks only, one per
   client process. Its data is a named volume.
2. **Two buckets, never shared.** `unset-private` holds what is ours: `drafts/<did>/…`, `media/<did>/…`,
   `legal-hold/<holdId>/…` (plan §5.8, book P2.18 key convention). `unset-pds` is the PDS's blobstore and nothing
   else. No bucket is public, and no browser ever reaches the store: no presigned S3 URL is ever sent; members' media
   reaches browsers only through `media` (signed draft URLs, P2.19; the media proxy, P3.09).
3. **One key per process, least privilege, enforced by the store** and proven by a denial test per key: `web`
   read-write and tagging on `unset-private/drafts/*`, plus `List` on `unset-private` (bucket-wide; see Consequences); `media` read-only on `unset-private/drafts/*` and `media/*`;
   the PDS read-write on `unset-pds` only; later processes get their own key in the step that adds them: renditions
   in `media/*` are written by the step that makes them (P2.19, Phase 4), and `legal-hold/*` by P4.07 (the sealed
   legal hold). Until then nothing may write those prefixes. Keys are secrets in the dev-stack secret files, never in the
   checkout or a log. `s3.json`, which holds every key, is mounted only into `objects`. Only the store's one-shot
   setup holds the admin identity, which creates the buckets; its secret file is readable only by the setup's uid,
   and no long-running process mounts it. Rotation is manual: new values in `s3.json` and the client's secret file,
   then restart `objects` and the client, written down in the compose step's runbook. Per-DID isolation inside
   `drafts/` is not the store's: one `web` key reaches every member's prefix, so it rests on the domain building every
   key from the signed-in viewer's DID (P2.18), with a denial test.
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
6. **Encryption.** At rest the store runs with `-filer.encryptVolumeData`, so no object's bytes are plaintext in a
   volume file. It is not an erase mechanism: the per-chunk keys sit in the filer's metadata on the same disk and
   outlive a delete (Context), so this record makes no "ciphertext without a key" claim. It also
   does not protect against someone who takes the whole disk, because the keys sit beside the data. Against that
   the only protection is the host's disk encryption, and this record decides it explicitly: staging relies on the
   host as it is, which is not verified to be encrypted, and staging is invite-only test data; before any real
   member's draft is stored, P5.01 must put the store on an encrypted disk or seal `drafts/` with
   `infrastructure/seal`. No application-layer encryption is built now. Anything written to a third-party bucket is
   sealed by `infrastructure/seal` first (`legal-hold/` already is), built only if P5.01 picks one.
   In transit the store is plain HTTP on internal Docker networks on one host, one network per client. SigV4 signs
   each request's headers and payload hash, so it is not altered unseen, but it is not secret from the host. TLS
   becomes required the day the store or a client moves to another machine.
7. **Erasure, takedown and export.** `drafts/<did>/` and `media/<did>/` join the erasure registry and P3.07's
   outbox; the PDS's own account deletion removes `blocks/<did>/` as it removes the folder today. A delete is a
   tombstone, and vacuum is a rewrite and unlink, not a disk wipe. So:
   - physical removal runs in this order, from the store's one-shot admin job: delete the objects; purge the
     filer's metadata change log (below), because its files are themselves stored in volumes; wait until the
     filer has deleted the objects' chunks, which it does asynchronously, by re-checking that the volumes report
     the garbage; then a forced vacuum at threshold 0 (`lock`, `volume.vacuum -garbageThreshold 0`, `unlock`),
     which compacts every volume holding any garbage. It runs after every erasure batch and every takedown,
     never on a schedule a small delete could fall under. It is manual until P5.08b: a runbook step Alex runs,
     written in P2.18s. P3.07's automated erasure must not ship to real members unless the vacuum follows it
     automatically, so P3.07 either runs this sequence itself or waits for P5.08b. `-master.garbageThreshold=0.01`
     stays as a backstop only;
   - the filer's metadata change log under `/topics/.system/log/` keeps key names, DIDs included. The runbook
     removes every day's folder before the current one on each erasure run; between runs, and for the current
     day, names survive. Forcing LevelDB to compact its tombstones is also not solved: P2.18s must either find
     the compaction control or move the filer store to one that deletes for real. Both are accepted for staging
     only, and both are one P5.01 gate before real members' drafts: a deleted object's name and chunk key may
     survive in the filer's files until then;
   - interim takedown of a single object in `unset-private` (an illegal draft image, later a rendition) has no
     automated path either: the P2.18s runbook gives the manual procedure (delete the one key with the setup's
     admin key, then the sequence above), and P5.08a automates it with the PDS path;
   - freed disk blocks are not overwritten. On staging that rests on the host as it stands (Decision 6). P5.01 puts
     the store on an encrypted disk, so freed blocks are ciphertext under a key that leaves with the disk;
   - PDS blobs: account deletion removes `blocks/<did>/`. Whether the PDS clears stale `tmp/<did>/` uploads itself
     is not verified, so every procedure below names `tmp/` explicitly. A takedown moves a blob to `quarantine/`, which is not a delete. P2.18p writes the interim manual
     procedure: delete the DID's or the CID's objects under `blocks/`, `tmp/` and `quarantine/` with the PDS key,
     then the forced vacuum. P5.08a (takedown) replaces it with an automated path, and CSAM is always hard-deleted
     from `quarantine/` too;
   - versioning and object lock stay off on both buckets. The setup never enables them, and a test checks that
     neither bucket reports versioning on, so no older copy survives a delete;
   - the P2.18s compose step tests erasure itself, not only its flags: after a put, a plaintext marker is in no
     volume file. Because that already holds before any delete, erasure is checked on the ciphertext: the test
     reads the object's encrypted chunk bytes from its volume file before the delete, and after delete plus the
     forced vacuum those bytes are in no volume file. The same test, with the vacuum skipped, must fail;
   - there are no backups of the store before P5.04. P5.04 must keep the erasure registry so a restore replays every
     erasure and takedown, and must expire purged objects from backups within its retention window.

## Alternatives
- **Garage (AGPL-3.0).** No object tagging, which the lifecycle rules use. Rejected.
- **MinIO.** Archived community edition, no images. Rejected.
- **`@aws-sdk/client-s3` in the app.** Full featured, but a large tree and the credential chain P1.29i refused.
  Rejected; a ~120-line SigV4 signer of our own stays the fallback if `aws4fetch` stops being maintained.
- **PDS blobs stay on disk** (the 2026-10-30 plan's recommendation). Simpler and the blobs are public anyway, but Alex
  asked for S3 for both on 2026-11-15.
- **One bucket for everything.** Fewer keys, but a PDS key could then reach members' drafts. Rejected.

## Consequences
- A new service, image and volume in dev and local; the mirror and lock gain an entry (Alex runs the mirror workflow).
- Durability: one node, one volume, no replication and no backup before P5.04. Losing the volume loses every draft
  and, after P2.18p, every PDS blob; the PDS's blobs join that single point of failure, where today they share the
  PDS's own volume. Accepted for staging; P5.01 and P5.04 decide production's replication and backups, and the restore
  drill must cover the store.
- The PDS gains a network path to `objects` and loses its blob folder; a store outage now also stops PDS blob reads
  and writes (records and sign-in keep working).
- The store's `List` action is bucket-wide: a key that may list `unset-private` sees every key name, DIDs included.
  Only `web` lists, and it already holds every member's DID in Postgres, so this adds no new kind of exposure; no
  other process gets `List`.
- One more dependency (`aws4fetch`) on the server, recorded in the dependency notes.

## Compliance
Book steps P2.18k, P2.18s (store and adapter), P2.18p (PDS blobstore), P2.18 and P2.19; their named tests; preflight
checks for the PDS's S3 settings; the RoPA rows for draft media and renditions (P2.18).
