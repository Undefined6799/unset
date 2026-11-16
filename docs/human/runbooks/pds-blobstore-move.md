# Moving the PDS's blobs into the object store (P2.18p)

From P2.18p the PDS keeps its blobs in the object store's `unset-pds` bucket (ADR 0041 Decision 5), not on its data
volume. This runbook moves an existing stack's blobs there once, before the first `up` of a commit that has P2.18p. A
fresh stack with no blobs needs only step 2.

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

Back up the database as for any staging pull. Then back up the blobs to a file only you can read:

```sh
umask 077
IMG=$(docker inspect --format '{{.Config.Image}}' "$($DC ps -q objects)")
docker run --rm --network none --entrypoint tar -v unset-dev_pdsdata:/src:ro -v "$PWD/..":/out "$IMG" \
  -czf /out/pds-blocks-backup.tgz -C /src blocks
```

The objects image is used only because it is already on the host, and it has `tar`. It runs as uid 1000, the PDS's
own uid, so it can read the blobs; the folder above the checkout must be writable by uid 1000 (it is on the staging
VM, where the deploy user is 1000). The backup holds members' blobs:
delete it in step 6, and replay any erasure made while it exists.

## 2. Make the PDS's key and identity

The key pair is made on the host and written straight into the files that need it. It is never typed, printed or
committed. The identity goes into `objects_s3` now; the PDS's half waits in a pending file until step 5, because the
commit before P2.18p refuses those two names in `pds.env` (C30). With `umask 077`, from the checkout:

```sh
node -e '
const fs = require("node:fs"), { randomBytes } = require("node:crypto");
const id = randomBytes(16).toString("hex"), secret = randomBytes(30).toString("base64url");
const actions = ["Read:unset-pds", "Write:unset-pds", "List:unset-pds"];
const identities = { identities: [{ name: "pds", credentials: [{ accessKey: id, secretKey: secret }], actions }] };
fs.writeFileSync("../unset-dev-secrets/objects_s3.new", JSON.stringify(identities), { mode: 0o600 });
fs.writeFileSync("../unset-dev-env/pds-s3.pending",
  `PDS_BLOBSTORE_S3_ACCESS_KEY_ID=${id}\nPDS_BLOBSTORE_S3_SECRET_ACCESS_KEY=${secret}\n`, { mode: 0o600 });
'
sudo chown 1000:1000 ../unset-dev-secrets/objects_s3.new
sudo chmod 0400 ../unset-dev-secrets/objects_s3.new
sudo mv ../unset-dev-secrets/objects_s3.new ../unset-dev-secrets/objects_s3
npm run dev:down && npm run dev:up
```

The store reads the file only at start, and Compose mounts the file itself, so a replaced file is seen only by a new
container: hence `dev:down` and `dev:up`, not a restart. The three actions are exactly the ones
`tests/integration/storage/pds-key.test.ts` proves: everything the PDS does in `unset-pds`, and denial in
`unset-private`, for a new bucket, and without a signature. The file has no `Admin` identity (ADR 0050).

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

- open a post or a profile with an image from before the move, and upload a new image, then open it.

## 6. Clean up, after Alex has tested

Remove the old blobs from the data volume, then the backup:

```sh
$DC stop pds
docker run --rm --network none --entrypoint rm -v unset-dev_pdsdata:/src --user 1000:1000 "$IMG" -rf /src/blocks
$DC start pds
rm ../pds-blocks-backup.tgz
```

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
