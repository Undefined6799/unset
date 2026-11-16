# Moving the PDS's blobs into the object store (P2.18p)

From P2.18p the PDS keeps its blobs in the object store's `unset-pds` bucket (ADR 0041 Decision 5), not on its data
volume. This runbook moves an existing stack's blobs there once, before the first `up` of a commit that has P2.18p. A
fresh stack with no blobs needs only step 2 (the key and identity) and step 5 (moving the key pair into `pds.env` and
starting the P2.18p commit); it skips the backup, the copy, the check and the clean-up.

Run it on the host, from the checkout, with the stack on a commit before P2.18p that already runs the `objects`
service (main at 1514182 or later). Throughout:

```sh
DC='docker compose -f deployment/compose.dev.yaml --env-file ../unset-dev-env/dev-public.env'
```

Use `compose.dev.source.yaml` on a source build. The data volume is `unset-dev_pdsdata` (check with
`docker volume ls`). Nothing below prints a key, and the loops print only counts, never a DID or a CID.

## How the two layouts map

The PDS's disk store (`@atproto/pds` 0.5.51 `src/disk-blobstore.ts` at atproto fb16c8e0) keeps
`/home/node/blocks/<did>/<cid>`, temporary uploads in `blocks/tempt/<did>/` and quarantined blobs in
`blocks/quarantine/<did>/<cid>`. Its S3 store (`@atproto/aws` `src/s3.ts`, same commit) uses `blocks/<did>/<cid>`,
`tmp/<did>/` and `quarantine/<did>/<cid>`. So each DID folder goes to `blocks/`, each quarantine DID folder goes to
`quarantine/`, and `tempt/` is not copied. A temporary upload is either made permanent or dropped within the hour.

## 1. Back up first

Back up the database as for any staging pull. Then back up the blobs into a folder of their own, beside the checkout
and outside the secrets and env folders, that only uid 1000 can enter:

```sh
sudo install -d -m 0700 -o 1000 -g 1000 ../pds-backup
IMG=$(docker inspect --format '{{.Config.Image}}' "$($DC ps -q objects)")
docker run --rm --network none --user 1000:1000 --entrypoint sh -v unset-dev_pdsdata:/src:ro \
  -v "$PWD/../pds-backup":/out "$IMG" -c 'umask 077 && tar -czf /out/pds-blocks.tgz -C /src blocks'
```

The objects image is used only because it is already on the host and has `tar`. It runs as uid 1000, the PDS's own
uid, so it can read the blobs. The container mounts only the data volume, read-only, and the backup folder, and sets
its own `umask 077`, so the tarball is mode 0600 inside a 0700 folder (the host's umask does not reach the container).
The backup holds members' blobs: see step 6 for how long it is kept, and replay any erasure on it while it exists.

## 2. Make the PDS's key and identity

The key pair is made on the host and written straight into the files that need it. It is never typed, printed or
committed. The identity is added to `objects_s3` now, beside any identity already there; the PDS's half waits in a
pending file until step 5, because the commit before P2.18p refuses those two names in `pds.env` (C30). From the
checkout:

```sh
S=../unset-dev-secrets
sudo cp -p $S/objects_s3 $S/objects_s3.before-pds
sudo cat $S/objects_s3 | node -e '
const fs = require("node:fs"), { randomBytes } = require("node:crypto");
const file = JSON.parse(fs.readFileSync(0, "utf8"));
if (!Array.isArray(file.identities)) throw new Error("objects_s3 has no identities list");
if (file.identities.some((i) => i.name === "pds")) throw new Error("objects_s3 already has a pds identity");
const id = randomBytes(16).toString("hex"), secret = randomBytes(30).toString("base64url");
const actions = ["Read:unset-pds", "Write:unset-pds", "List:unset-pds"];
file.identities.push({ name: "pds", credentials: [{ accessKey: id, secretKey: secret }], actions });
fs.writeFileSync(process.argv[1], JSON.stringify(file), { mode: 0o600 });
fs.writeFileSync(process.argv[2],
  `PDS_BLOBSTORE_S3_ACCESS_KEY_ID=${id}\nPDS_BLOBSTORE_S3_SECRET_ACCESS_KEY=${secret}\n`, { mode: 0o600 });
' $S/objects_s3.new ../unset-dev-env/pds-s3.pending
sudo chown 1000:1000 $S/objects_s3.new
sudo chmod 0400 $S/objects_s3.new
sudo mv $S/objects_s3.new $S/objects_s3
npm run dev:down && npm run dev:up
```

The script keeps every identity already in the file and stops, writing nothing, if the file has no identities list or
already has a `pds` identity. `objects_s3.before-pds` is the old file, with its owner and mode; delete it once the
switch has been tested. The store reads the file only at start, and Compose mounts the file itself, so a replaced file
is seen only by a new container: hence `dev:down` and `dev:up`, not a restart. The three actions are exactly the ones
`tests/integration/storage/pds-key.test.ts` proves: everything the PDS does in `unset-pds`, and denial in
`unset-private`, in a sibling bucket, for a new bucket, and without a signature. The file has no `Admin` identity
(ADR 0050).

## 3. Copy, with the PDS stopped

```sh
$DC stop pds
docker run --rm --network "container:$($DC ps -q objects)" --entrypoint sh -v unset-dev_pdsdata:/src:ro \
  --user 1000:1000 --read-only --tmpfs /tmp "$IMG" -c '
set -e
cd /src/blocks
for did in *; do
  case "$did" in tempt|quarantine) continue ;; esac
  [ -d "$did" ] && weed filer.copy -c 4 "$did" http://127.0.0.1:8888/buckets/unset-pds/blocks/ >/dev/null
done
if [ -d quarantine ]; then
  for did in quarantine/*; do
    [ -d "$did" ] && weed filer.copy -c 4 "$did" http://127.0.0.1:8888/buckets/unset-pds/quarantine/ >/dev/null
  done
fi
echo copied'
```

The container shares the store's network namespace, so it reaches the store's loopback-only filer and master, and
nothing else. It mounts the data volume read-only. `weed filer.copy` reads the filer's cipher setting and encrypts
every chunk it uploads (`weed/command/filer_copy.go` at 4.53), as the filer does for a put. That it names each copied
folder after its last part, so `<did>` lands at `blocks/<did>/`, is from its usage text and unverified here: step 4
reads every blob back from the key it must have, so a wrong layout cannot pass.

## 4. Check every blob: count and checksum

```sh
docker run --rm --network "container:$($DC ps -q objects)" --entrypoint sh -v unset-dev_pdsdata:/src:ro \
  --user 1000:1000 --read-only --tmpfs /tmp "$IMG" -c '
cd /src/blocks
ok=0; bad=0
for file in */* quarantine/*/*; do
  case "$file" in tempt/*|quarantine/*/*/*) continue ;; esac
  [ -f "$file" ] || continue
  case "$file" in quarantine/*) key="$file" ;; *) key="blocks/$file" ;; esac
  here=$(sha256sum "$file" | cut -d" " -f1)
  there=$(wget -q -O - "http://127.0.0.1:8888/buckets/unset-pds/$key" | sha256sum | cut -d" " -f1)
  if [ "$here" = "$there" ]; then ok=$((ok + 1)); else bad=$((bad + 1)); fi
done
echo "match $ok, differ $bad"'
```

Go on only when `differ` is 0 and `match` equals the number of blob files: `find blocks -type f -not -path "blocks/tempt/*" | wc -l`
in the same kind of container. If anything differs, run step 3 again for the whole tree; it overwrites.

## 5. Switch

Move the key pair into `pds.env`, check out the P2.18p commit and start the stack:

```sh
cat ../unset-dev-env/pds-s3.pending >> ../unset-dev-env/pds.env && rm ../unset-dev-env/pds-s3.pending
grep -c '^PDS_BLOBSTORE_S3_' ../unset-dev-env/pds.env   # prints 2
npm run dev:down && npm run dev:up
```

The preflight now requires the store's settings (C33) and both key names in `pds.env` (C30). The PDS starts on the
store. Then:

- the owner opens a post or a profile with an image from before the move, uploads a new image, then opens it.

## 6. Clean up, after the owner has tested

Keep one copy of every blob at all times. So first back up the store's volume, with the store stopped, and check that
the backup reads back; only then remove the old blobs from the PDS's data volume:

```sh
$DC stop pds objects
docker run --rm --network none --user 1000:1000 --entrypoint sh -v unset-dev_objectsdata:/src:ro \
  -v "$PWD/../pds-backup":/out "$IMG" -c 'umask 077 && tar -czf /out/objects-data.tgz -C /src . && tar -tzf /out/objects-data.tgz >/dev/null && echo readable'
$DC start objects
docker run --rm --network none --entrypoint rm -v unset-dev_pdsdata:/src --user 1000:1000 "$IMG" -rf /src/blocks
$DC start pds
```

Go on to remove the old blobs only if it printed `readable`. Keep `pds-blocks.tgz` until the store's own backups
exist (P5.04), or delete it once `objects-data.tgz` has been copied where the database backups go; then delete
`objects_s3.before-pds`. Both tarballs hold members' blobs, so each is under the erasure rule below for as long as it
exists.

## Rolling back

Remove the two `PDS_BLOBSTORE_S3_` lines from `pds.env` (the earlier commit's C30 refuses them), check out the commit
before P2.18p, and run `npm run dev:down && npm run dev:up`. The PDS goes back to its disk blobs as they were at step 3.
Anything uploaded after the switch exists only in the bucket. On staging, either accept losing it, or copy it back
first with `wget` from `http://127.0.0.1:8888/buckets/unset-pds/blocks/<did>/<cid>` into the disk layout above, in the
same kind of container with the volume mounted read-write. Step 6 removes the way back, so it waits until the switch
has been tested.

## Erasure after the move

The PDS's own account deletion on S3 removes only `blocks/<did>/<cid>` for the CIDs in the account's blob table, and it
logs a failure instead of stopping (`packages/pds/src/actor-store/actor-store.ts` `destroy` at atproto fb16c8e0). It
never removes `tmp/<did>/` or `quarantine/<did>/`. So every erasure of a PDS account also runs
`docs/human/runbooks/object-store.md`'s physical removal for all three prefixes, then the forced vacuum.

Until step 6 has run, the old copy is still on the PDS's data volume: an erasure made after the switch also removes
`blocks/<did>/` and `blocks/quarantine/<did>/` there, in the same kind of container with the volume mounted
read-write. And while `pds-blocks.tgz` or `objects-data.tgz` exists, each erasure is replayed on it (unpack, remove the
member's folders, pack again in the backup folder), or the tarball is deleted.
