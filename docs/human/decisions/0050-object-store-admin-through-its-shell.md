# 0050 — The object store's buckets and clean-up run through its own shell; no S3 admin key

Status: Accepted by Alex, 2026-11-16 00:58:07Z, against 372aaff (his line "accept ADR 0050 at 372aaff", typed in
the project chat in answer to the coordinator's request after its review of that head). The only changes since
that head are this status paragraph, the index row's status and the ADR 0001 acceptance line. The choice came from the card "Choose how the object store gets its buckets and runs
its clean-up" in the storage thread. Alex did not tap an option there. He asked which option would be easier to
bring to production and answered that production "will likely be an hosted S3". The thread then took "Store's own
shell, no admin key", closed the card with it and told him, and his acceptance line confirms it. From here the
record changes only to be marked superseded. It supersedes two clauses of ADR 0041:
- Decision 3: "Only the store's one-shot setup holds the admin identity, which creates the buckets; its secret file is
  readable only by the setup's uid, and no long-running process mounts it".
- Decision 7: "from the store's one-shot admin job", and, in the takedown item, "with the setup's admin key".
Nothing else in ADR 0041 changes.

## Context
ADR 0041 planned a one-shot setup container holding an S3 admin identity. That container would create the buckets
and run the physical-removal sequence (delete, purge the metadata log, wait, forced vacuum). Building it in P2.18s
showed it cannot work as written:
- The vacuum and the metadata-log purge are `weed shell` commands. They speak gRPC to the master and the filer, which
  the objects image binds to 127.0.0.1 on purpose: the filer's IAM gRPC is unauthenticated without a signing key
  (#1597).
- A second container could reach them only by sharing the store's network namespace. Preflight C17 refuses any
  `network_mode` other than the token reader's `none`.
- A Compose `command` is refused by the strict subset, so a setup service would also need its own image to build,
  sign and lock.
- An S3 admin identity in `s3.json` would sit on disk for the store's whole life, to be used once.

`weed shell` inside the objects container reaches master and filer on loopback with no S3 identity at all.
Checked on 4.53 (2026-11-16):
- `s3.bucket.create -name unset-private` creates the bucket. Versioning and Object Lock stay off unless `-withLock`
  is passed (weed/shell/command_s3_bucket_create.go at 4.53).
- Creating a bucket that exists exits 1.
- `lock`, `volume.vacuum -garbageThreshold 0`, `unlock` runs.

Production will likely use a hosted S3 (Alex, 2026-11-16). There, buckets and keys are made at the provider, and
none of this runs. So this mechanism serves the dev, local and staging stacks only.

## Decision
1. **No S3 identity has the Admin action.** `s3.json` holds only the scoped per-process keys of ADR 0041 Decision 3,
   and a test fails on any identity with `Admin`. Nothing can create, delete or reconfigure a bucket over S3.
2. **The stack script creates the buckets.** After `up`, `deployment/preflight/stack.ts` runs
   `docker compose exec -T objects weed shell` with the commands on stdin. It lists the buckets, then creates
   `unset-private` and `unset-pds` only if missing, never with `-withLock`, and fails the `up` if the shell fails.
   The same plan runs on every `up`, so it is idempotent.
3. **Removal, takedown and vacuum run the same way.** ADR 0041 Decision 7's order is unchanged: delete, purge the
   metadata log, wait for the chunk deletes, forced vacuum. A person with access to the host's Docker runs it, from
   the runbook, through `docker compose exec -T objects weed shell`. A single-object takedown in `unset-private` is
   `fs.rm` on its filer path in that same shell, followed by that sequence. It is manual until P5.08a and P5.08b,
   as ADR 0041 already says.
4. **Who can do this is who can reach the host's Docker daemon.** That person can already read every volume. No new
   credential exists to leak, rotate or mount.

## Alternatives
- **The ADR 0041 setup image with an admin key.** It needs a new image and a stored admin key, and it still can't
  vacuum without an exec into objects. Rejected.
- **A setup container sharing the store's network namespace.** It loosens C17 for one service and still needs its
  own image. Rejected.
- **Bucket creation in the objects image's own start script.** It puts a shell supervisor in front of `weed` as
  PID 1, and the vacuum would still need an exec. Rejected.

## Consequences
- One fewer image and one fewer secret. The objects service mounts `s3.json`, and nothing else in the stack holds a
  store-wide key.
- Bucket creation depends on the stack script. A stack started with plain `docker compose up` has no buckets, so
  every write fails as `objects.unavailable` (fail closed), never silently into the wrong place.
- Erasure and takedown stay a person's step on the host until P5.08a and P5.08b, unchanged from ADR 0041.
- A hosted production store needs its own bucket and key setup at the provider, decided in P5.01.

## Compliance
The compose step that adds the `objects` service (P2.18s) carries the tests:
- `objects_no_admin_identity`: no identity in the dev-stack `s3.json` template has `Admin`.
- `objects_buckets_created_by_stack`: `stack.ts` runs the bucket plan after `up`, and fails the `up` when it fails.
- `objects_no_versioning`: neither bucket reports versioning on.
- The erasure tests of ADR 0041 Decision 7, which run the vacuum through the same shell.
The runbook holds the removal and takedown commands. Acceptance is Alex's line on the pull request that adds this
record. ADR 0001 notes the proposal at its end.
