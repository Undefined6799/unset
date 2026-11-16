# The object store: erasure, takedown and vacuum (P2.18s)

The `objects` service (SeaweedFS 4.53, ADR 0041) holds two buckets: `unset-private` for members' drafts and media, and
`unset-pds` for the PDS's blobs. A delete only marks the bytes as deleted (a tombstone). Until a vacuum rewrites the
volume, the deleted bytes are still in its file. This runbook removes them for real.

It runs by hand until P5.08a and P5.08b automate it (ADR 0041 Decision 7). It applies to the dev, local and staging
stacks only. Production will use a hosted S3 (ADR 0050), where the provider's delete and lifecycle rules apply.

Who can run it: whoever can reach the host's Docker daemon. That person can already read every volume (ADR 0050
Decision 4). No S3 key is used, and no identity in `objects_s3` ever has `Admin`.

## Opening the store's shell

From the checkout on the host, with the stack up:

```sh
docker compose -f deployment/compose.dev.yaml --env-file ../unset-dev-env/dev-public.env exec -T objects weed shell
```

Use `compose.dev.source.yaml` on a source build, or `compose.local.yaml` with `local:up`. The shell reads commands
from stdin, one per line, and talks only to the store's own loopback services. Every step below is a block of lines
fed to it, for example `printf 'lock\nvolume.vacuum -garbageThreshold 0\nunlock\n' | docker compose … exec -T objects
weed shell`.

`fs.rm` exits 0 even when the key does not exist. It prints `no entry is found in filer store` in that case, so read
what it prints.

## Physical removal (after every erasure batch and every takedown)

Run these in this order (ADR 0041 Decision 7). Never put them on a schedule that a small delete could fall under.

1. **Delete the objects.** For a member's erasure, delete the member's own folders:
   - `fs.rm -r /buckets/unset-private/drafts/<did>`
   - `fs.rm -r /buckets/unset-private/media/<did>`
   - in the PDS bucket, from P2.18p: `fs.rm -r /buckets/unset-pds/blocks/<did>`, `fs.rm -r
     /buckets/unset-pds/tmp/<did>` and `fs.rm -r /buckets/unset-pds/quarantine/<did>`. The PDS's own account
     deletion removes only some of `blocks/<did>/` and none of the other two (`pds-blobstore-move.md`, "Erasure after
     the move").
2. **Purge the filer's metadata log** with `fs.log.purge -daysAgo 1`. The log's files are themselves stored in
   volumes, and they keep key names, DIDs included. This removes every day's log before today's. Today's log, and
   anything written between runs, keeps the names until the next run.
3. **Wait for the chunk deletes.** The filer deletes chunks asynchronously. Run `volume.list` until the bucket's
   volumes show `DeleteCount` and `DeletedByteCount` covering what you deleted, usually within seconds.
4. **Force the vacuum:**
   ```
   lock
   volume.vacuum -garbageThreshold 0
   unlock
   ```
   This compacts every volume that holds any garbage, so the deleted bytes are in no volume file afterwards. A
   threshold of 0 matters: the server's own backstop (`-master.garbageThreshold=0.01`) runs only on its interval
   and only above 1 %.

`objects_erase_removes_bytes` (`deployment/images/objects-erasure.image.test.ts`) runs steps 1, 3 and 4 against the
built image. It checks that the object's stored bytes stay in its volume file after the delete alone, and are in no
file under `/data` after the vacuum.

## Taking down one object in `unset-private`

This is for an illegal draft image, and later a rendition. There is no automated path until P5.08a.

1. `fs.rm /buckets/unset-private/<key>` for the one key. Check that it printed no `no entry` line.
2. Then steps 2 to 4 of physical removal.

CSAM is always hard-deleted this way, `quarantine/` included once the PDS bucket exists. Record the takedown as the
moderation runbook says, never the key's content.

## What this does not remove yet

Each of these is accepted for staging only, and each is a P5.01 gate before any real member's draft is stored:

- **The filer's LevelDB keeps tombstones until it compacts on its own.** Until then, a deleted entry's metadata may
  survive in `/data/filerldb2`: its full object path and its chunk keys. Anything we put in a path, such as the DID
  in `drafts/<did>/`, survives with it. This is why new key layouts avoid DIDs and handles wherever the caller allows. SeaweedFS 4.53's shell has no command to force that compaction (`help`
  lists none; checked 2026-11-16). P5.01 must move the filer store to one that deletes for real, or find the control.
- **Freed disk blocks are not overwritten.** On staging that rests on the host's disk as it stands. P5.01 puts the
  store on an encrypted disk (ADR 0041 Decision 6).
- **There are no backups before P5.04.** P5.04 must keep the erasure registry, so that a restore replays every
  erasure and takedown.

Versioning and object lock stay off on both buckets, so no older copy survives a delete. The bucket setup never
passes `-withLock`, and `objects_buckets_created_by_stack` checks that neither bucket reports versioning on.

## Rotating the identities file

`objects_s3` holds the scoped per-process keys (`docs/human/runbooks/dev-stack-secrets.md`). To rotate one:
1. Write the new file with the same owner and mode (`1000:1000`, `0400`).
2. Run `npm run dev:down`, then `npm run dev:up`. The store reads the file only at start, and the bucket setup runs
   again.
3. Update the caller's own secret.

The server reads the file at start. A missing or unparsable file stops the server, and an empty identities list
denies every request.
