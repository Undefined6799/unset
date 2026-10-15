# Development stack secrets

**Never run `docker compose down -v` on this stack.** It deletes the Postgres and PDS data volumes, and from P1.35 on
the dev PDS holds the lexicon authority's account; recovery is P1.34's restore runbook. `npm run dev:down` never passes `-v`.

`deployment/compose.dev.yaml` mounts each file below at `/run/secrets/<name>` in the services listed, and nothing else
reads them.

## Where the folder lives

The secrets live in `unset-dev-secrets/`, a folder **beside** your checkout of this repository, never inside it:

```text
~/src/
├── unset/                 the repository checkout
├── unset-dev-secrets/     the secret files below
├── unset-dev-env/         dev-public.env, the stack's interpolation file
├── unset-dev-ca/          the local dev root and its key (local stack only; never bound)
└── unset-dev-trust/       root.pem only: the local dev root's public certificate
```

Postgres builds from the repository root, so a secrets folder inside the checkout would sit inside a build context,
and the preflight refuses that (architecture record 2026-10-12-p127u-bind-ancestors-and-build-context (b)). A
`.dockerignore` entry does not make it safe: the file can change, and a later `COPY . .` would bake the secrets into an
image layer.

The preflight also checks each bind-mounted path (such as `deployment/postgres/init`) and every folder above it and
above each secret file: each must be owned by root or by you, and writable by no group and no other user. Keep the
checkout and `unset-dev-secrets/` under your own home directory, not under `/tmp` or a shared folder. A checkout that
others can write to fails every bind inside it, so clone under `umask 022`, or run `chmod -R go-w` on an existing
checkout (Amendment 6 of the same record). Database data is a named volume (`pgdata`), which Docker keeps under its own
root-owned folder, so it needs nothing from you (Amendment 1 of the same record).

`unset-dev-env/` holds the live env files, apart from the secrets so that folder holds only mounted secrets. Make it
yours with mode 0700, and each file yours, mode 0600, with a single hard link; any symbolic link on the way must also be
yours or root's (Amendment 6). Start `dev-public.env` from the template `deployment/env/dev-public.example.env`,
whose values are all placeholders. No live env file stays in the checkout, even one with nothing secret in it today: it
would sit in postgres's build context, and the preflight refuses that (Amendments 2 and 3 of the same record).

## Layout (architecture record 2026-10-12-c9-secret-file-owner)

Compose bind-mounts a file secret unchanged: the container sees the host file's owner and mode (compose-spec
05-services.md, `secrets`: "uid, gid, and mode attributes are not implemented in Docker Compose when the source of the
secret is a file"). So each file is owned by the numeric uid of the one service that reads it, and the folder is what
keeps every other host account out:

- the folder: mode `0700`, owned by you (the deploy user);
- each secret file: a regular file, mode `0400`, owned by the reading service's uid;
- a file is mounted only by services running as that one uid, so the migrator's password has two copies.

| File | Owner (uid:gid) | Read by | Holds |
| --- | --- | --- | --- |
| `pg_superuser_password` | `999:999` | postgres | the bootstrap superuser's password |
| `pg_migrator_password` | `999:999` | postgres | the `migrator` role's password, set at initdb |
| `pg_tap_password` | `999:999` | postgres | the `tap` role's password, set at initdb |
| `migrate_pg_password` | `65532:65532` | migrate | the same `migrator` password, to log in |
| `pg_web_password` | `65532:65532` | migrate | the `web` role's password, set after migrations |
| `pg_api_password` | `65532:65532` | migrate | the `api` role's password |
| `pg_indexer_password` | `65532:65532` | migrate | the `indexer` role's password |

Keep nothing else in this folder. The preflight does not check that yet: C9 judges the mounted secrets only and never
lists the folder, so a stray file here passes (P1.34l (#754) adds that listing). The dev seed
(P1.29s) writes `.seeded.json`, the seeded test accounts' handles, DIDs and passwords, to `unset-dev-env/` instead,
mode `0600` and owned by you (Amendment 7 of the bind-ancestors record). Nothing in a container reads it.

Each password is at least 16 bytes (`PG_PASSWORD` and the role files are read as `secretFile({ minBytes: 16 })`).

## The PDS's env file (P1.29a)

The PDS reads its settings only from its environment (`@atproto/pds` 0.5.37, `dist/config/env.js`), so its secrets
cannot be mounted files. They go in `unset-dev-env/pds.env`, yours, mode `0600`, which the preflight checks like
`dev-public.env`. Start it from `deployment/env/pds.example.env`; it holds exactly these four names, and every other PDS
setting is written out in `compose.dev.yaml`:

| Name | Make it with |
| --- | --- |
| `PDS_JWT_SECRET` | `openssl rand -hex 32` |
| `PDS_ADMIN_PASSWORD` | `openssl rand -hex 32` (the preflight's C7 wants at least 32 characters) |
| `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX` | `openssl ecparam --name secp256k1 --genkey --noout --outform DER \| tail --bytes=+8 \| head --bytes=32 \| xxd --plain --cols 32` (the PDS installer's own command, bluesky-social/pds v0.4.5037 `installer.sh:16`) |
| `PDS_RECOVERY_DID_KEY` | the public `did:key` of a recovery key whose private half stays offline; set it before the first account, because it cannot be added to existing DID documents later (C6) |

Write the file under `umask 077` so it is never readable by others, even for a moment. The PDS's data, its SQLite
databases and blobs, is the named volume `pdsdata`, which Docker keeps; nothing in your folders holds it.

## Creating or rotating a file

Which files can be rotated on a running stack:

- `pg_web_password`, `pg_api_password` and `pg_indexer_password` can. migrate sets these roles' passwords from the
  files on every run (`syncRolePasswords`, infrastructure/postgres/roles.ts), so replace the file and restart the stack.
- `pg_superuser_password`, `pg_migrator_password` and `pg_tap_password` cannot yet. The postgres image reads them only
  at initdb, which runs only on an empty data volume (docker-library/postgres 18/trixie/docker-entrypoint.sh:347,
  `if [ -z "$DATABASE_ALREADY_EXISTS" ]`). Changing one later changes nothing in the database. Changing
  `migrate_pg_password` alone locks migrate out at once; changing `pg_migrator_password` alone breaks the pair:
  migrate is locked out after the next initdb. Change both together. Before P1.35 the only way is to remove the
  `pgdata` volume and start again, which loses the data; from P1.35 on, the warning above rules that out too.
- `migrate_pg_password` must always hold the same value as `pg_migrator_password`.

Setting another user as owner needs root once per file. From the folder that holds your checkout, write the value to
a file only you can read, install it, then remove your copy:

```sh
umask 077
mkdir -p unset-dev-secrets && chmod 0700 unset-dev-secrets
openssl rand -base64 32 | tr -d '\n' > unset-dev-secrets/.new
sudo install -o 999 -g 999 -m 0400 unset-dev-secrets/.new unset-dev-secrets/pg_migrator_password
sudo install -o 65532 -g 65532 -m 0400 unset-dev-secrets/.new unset-dev-secrets/migrate_pg_password
rm unset-dev-secrets/.new
```

The scratch copy stays inside the locked folder, so no other account can read it while it exists.

Rootless Docker is not supported yet: its container uids map to other host uids, so the owners above would be wrong
and the preflight fails closed.

## The local stack's dev root and leaf (P1.33g)

The local stack serves its two names with a leaf certificate signed by a dev root that you make once (record
2026-10-12-p134c-p134d-local-dev-root-ca, Amendments 1 and 2). The root is name-constrained: it can only vouch for your
local app host and local PDS host (and names under them), never for an IP address, and it can sign no other CA. Its key
lives in `unset-dev-ca/`, beside the checkout, which nothing ever binds or builds from.

Set `APP_HOST` and `PDS_HOST` in your shell to the two names in your local env file, then, from the folder that holds
your checkout, make the root (825 days at most):

```sh
umask 077
mkdir -p unset-dev-ca
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out unset-dev-ca/root.key
chmod 0400 unset-dev-ca/root.key
openssl req -x509 -new -key unset-dev-ca/root.key -sha256 -days 825 -subj "/CN=unset local dev root" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "nameConstraints=critical,permitted;DNS:$APP_HOST,permitted;DNS:$PDS_HOST,excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::" \
  -out unset-dev-ca/root.pem
mkdir -m 0755 unset-dev-trust
cp unset-dev-ca/root.pem unset-dev-trust/root.pem
chmod 0644 unset-dev-trust/root.pem
```

`unset-dev-trust/` holds only that copy of the root's public certificate, which P1.34d binds into pds and web; it is
never the CA folder, the env folder or the secrets folder. Copy it, never link it, and put nothing else there.

Then make the leaf (397 days), and install it:

```sh
umask 077
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out unset-dev-ca/leaf.key
openssl req -x509 -new -key unset-dev-ca/leaf.key -CA unset-dev-ca/root.pem -CAkey unset-dev-ca/root.key \
  -days 397 -sha256 -subj "/CN=$APP_HOST" \
  -addext "basicConstraints=critical,CA:FALSE" -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=serverAuth" -addext "subjectAltName=DNS:$APP_HOST,DNS:$PDS_HOST" \
  -out unset-dev-ca/leaf.pem
```

```sh
sudo install -o 65532 -g 65532 -m 0400 unset-dev-ca/leaf.pem unset-dev-secrets/local_tls_cert
sudo install -o 65532 -g 65532 -m 0400 unset-dev-ca/leaf.key unset-dev-secrets/local_tls_key
install -m 0600 unset-dev-ca/leaf.pem unset-dev-env/local-leaf.pem
rm unset-dev-ca/leaf.key unset-dev-ca/leaf.pem
```

The preflight runs as you and cannot read the leaf secret, which belongs to the edge's uid, so it judges the public
copy `local-leaf.pem` instead, written from the same `leaf.pem` in the same step. The key is never copied anywhere but
the secret. Under `--env local`:

- C26 fails unless `unset-dev-ca/` is a real folder with no links, and `unset-dev-trust/` is a real folder holding
  only `root.pem`: a regular file with one link that no group or other user can write.
- C18 fails unless `unset-dev-trust/root.pem` is byte for byte `unset-dev-ca/root.pem`, holds no private key, and is
  one CA certificate with the name constraints above; and unless `local-leaf.pem` is one certificate issued by it, is
  not a CA, names exactly `APP_HOST` and `PDS_HOST` with no IP address, and has at least 14 days left. It also fails
  unless `APP_HOST` is the host of web's `PUBLIC_ORIGIN`.

Check when the leaf expires with `openssl x509 -enddate -noout -in unset-dev-env/local-leaf.pem`. Renew it by
rerunning the leaf commands and the install lines; an expired or nearly expired leaf fails closed. From P1.34d on, a
stale copy is caught after start: `local:up` compares the leaf the edge serves with the copy and takes the stack down
on a mismatch.

## Starting and stopping

Docker Desktop is not supported; use the native Docker Engine on Linux. The wrapper talks only to a Docker socket on
this machine and refuses a daemon that names another host, which Docker Desktop's VM does (architecture record
2026-10-12-workspace-imports-and-remote-daemon, Amendment 3).

Only through the wrapper, which runs the preflight first with the same files (P1.27w):

```sh
npm run dev:up
npm run dev:down
```

The local stack (P1.34d) is `deployment/compose.local.yaml`, with the same wrapper under `--env local`:

```sh
npm run local:up
npm run local:down
```

After Compose starts it, `local:up` connects to the edge on 127.0.0.1:443 once for each name in
`unset-dev-env/local-leaf.pem`, trusting only `unset-dev-trust/root.pem`, and checks that the edge serves exactly that
certificate. If it does not, or the edge does not answer within a minute, the wrapper runs `local:down` and fails,
naming `unset-dev-env/local-leaf.pem`: rerun the leaf commands and the install lines above, then `local:up` again.

Never run `docker compose` or the preflight on this stack by hand: the wrapper is what keeps the preflight's inputs
and Compose's identical.
