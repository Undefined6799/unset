# Development stack secrets

**Never run `docker compose down -v` on this stack.** It deletes the Postgres and PDS data volumes, and from P1.35 on
the dev PDS holds the lexicon authority's account. No restore runbook exists yet. The step book plans a restore-drill
runbook (P5.08c, `docs/ai/book/phase-5.md:2256` and `:2271-2272`) and names `docs/human/runbooks/restore.md` (P6.19,
`docs/ai/book/phase-6.md:3004`). Until then a `down -v` loses that data. `npm run dev:down` never passes `-v`.

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
checkout (Amendment 6 of the same record). The deploy user's shell needs `umask 022` before the clone and before every
`git pull`, or the next fetched file is group-writable again. A C9 line that reads `FAIL C9 reason withheld (it
contained a configured value)` names no path, and it is not one failure: C9 checks each env and secret file's owner,
mode and hard links, the secrets folder and its parents, and every bind path's walk, and the preflight withholds any
reason that holds a configured value (a service name, for one). Work through that list in order; on the first staging
run on VM 315 (2026-10-21) the cause was a group-writable checkout, fixed with `chmod -R go-w` on the checkout.
Database data is a named volume (`pgdata`), which Docker keeps under its own root-owned folder, so it needs nothing
from you (Amendment 1 of the same record).

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
| `pg_web_password` (also) | `65532:65532` | web | the same file: web logs in as `web` with it (P2.04w) |
| `web_seal_keyring` | `65532:65532` | web | the seal keyring for the OAuth state and token sets |
| `web_oauth_client_keys` | `65532:65532` | web | the OAuth client's private signing keys |

Keep nothing else in this folder. The preflight does not check that yet: C9 judges the mounted secrets only and never
lists the folder, so a stray file here passes (P1.34l (#754) adds that listing). There is no `.seeded.json` and no
per-run account file (P1.29s, ADR 0023): Alice and Bob are made once by hand on the PDS. Password, DID, and email live
only there. Whoever runs the stack types the PDS password from memory or from this folder, never from the app
(`docs/ai/notes/how-to/alice-bob-pds-password.md`, ADR 0026).

Each password is at least 16 bytes (`PG_PASSWORD` and the role files are read as `secretFile({ minBytes: 16 })`).

## The web server's two files (P2.04w)

`web` and `migrate` both run as `65532`, so web mounts the same `pg_web_password` file migrate sets the role from. The
other two are web's alone. Make each with `umask 077`, then `chown 65532:65532` and `chmod 0400` as above.

- `web_seal_keyring`: a JSON keyring, one 32-byte key by id (`infrastructure/seal/keyring.ts`):
  `printf '{"active":"k1","keys":{"k1":"%s"}}' "$(openssl rand -base64 32)" > web_seal_keyring`.
  Rotating it is `unset-rewrap` (P1.14d), never an edit in place: a value sealed with a key that is gone cannot open.
- `web_oauth_client_keys`: a JSON array of private ES256 JWKs, each with a `kid` (1 to 4 keys; `oauth/oauth-client.ts`
  `parseClientKeys`). With Node 26 on your machine:
  `node -e 'const {generateKeyPairSync}=require("node:crypto");const jwk=generateKeyPairSync("ec",{namedCurve:"P-256"}).privateKey.export({format:"jwk"});process.stdout.write(JSON.stringify([{...jwk,kid:process.argv[1],alg:"ES256"}]))' web-2026-10 > web_oauth_client_keys`.
  Set `WEB_OAUTH_ACTIVE_KID` in `dev-public.env` to that kid. Adding or removing a key is a rotation: follow
  `docs/human/runbooks/oauth-key-rotation.md`, which keeps the old key until no token set names it.

Neither value is ever printed by the server: the keyring and the keys show as `[keyring]` and `[oauth keys]`.

The legal pages' three values are not secrets and live in `deployment/compose.dev.yaml` itself
(`PRIVACY_OFFICER_TITLE`, `PRIVACY_OFFICER_CONTACT`, `SUPPORT_EMAIL`): `Privacy Officer`,
`contact@staging.unset.sh` and `support@staging.unset.sh`, Alex's staging values (P1.36c). The preflight's C32 fails
`--env dev` if any value starts with `[to fill:` again (P1.38d), naming the service and keys. A change to them is a
PR.

## The PDS's env file (P1.29a, P1.36g, P1.36q)

The PDS reads its settings only from its environment (`@atproto/pds` 0.5.37, `dist/config/env.js`), so its secrets
cannot be mounted files. They go in `unset-dev-env/pds.env`, yours, mode `0600`, which the preflight checks like
`dev-public.env`. Start it from `deployment/env/pds.example.env`; every other PDS setting is written out in
`compose.dev.yaml`. One env per host: the same file is loaded by both compose files, and the preflight requires its
exact name set for the env it runs under (P1.36q). Under `--env local` it holds the first four names only; under dev
and prod all six.

| Name | Make it with |
| --- | --- |
| `PDS_JWT_SECRET` | `openssl rand -hex 32` |
| `PDS_ADMIN_PASSWORD` | `openssl rand -hex 32` (the preflight's C7 wants at least 32 characters) |
| `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX` | `openssl ecparam --name secp256k1 --genkey --noout --outform DER \| tail --bytes=+8 \| head --bytes=32 \| xxd --plain --cols 32` (the PDS installer's own command, bluesky-social/pds v0.4.5037 `installer.sh:16`) |
| `PDS_RECOVERY_DID_KEY` | the public `did:key` of a recovery key whose private half stays offline (below); set it before the first account, because it cannot be added to existing DID documents later (C6) |
| `PDS_EMAIL_SMTP_URL` | dev and prod only: `smtps://resend:<key>@smtp.resend.com:465`, with a Resend sending-only key as `<key>` |
| `PDS_MODERATION_EMAIL_SMTP_URL` | dev and prod only: the same form; a second sending-only key is recommended, the same key works |

Write the file under `umask 077` so it is never readable by others, even for a moment. The PDS's data, its SQLite
databases and blobs, is the named volume `pdsdata`, which Docker keeps; nothing in your folders holds it.

The mail key lives only in this file: never in the repository, a log, a chat or a command line you share. The preflight
reads the URLs' names and judges their form (C11: smtps, or `requireTLS=true`), and never prints a value. Which one
staging uses for moderation mail, a second key or the same one, is not recorded yet: Alex says, and this line is
updated. The preflight never compares the two.

The two from addresses are not secrets and are literals in `compose.dev.yaml`: `PDS_EMAIL_FROM_ADDRESS` and
`PDS_MODERATION_EMAIL_ADDRESS`. Each must be a sender your Resend account may send as; if the ones written there are
not, say which to use and they are changed in a pull request. The preflight fails a mail URL without its address, and
an address that is not a plain `name@domain` (C11, C19). Never put either in `pds.env`.

**The recovery key.** Make it on a device you keep offline, for example with goat (bluesky-social/goat `key.go`, read
2026-10-19): `goat key generate --type secp256k1` prints the secret key and its public `did:key`. Keep the secret key
offline only. Put the `did:key` line, and nothing else from that output, in `pds.env`.

**The first account.** Make it once by hand, with an invite code from the one-off below, as the tester it is for;
its password, DID and email live only with that person (ADR 0026).

## The dev edge's self-signed leaf (P1.38e, dev only; ADR 0032)

Under dev the edge serves both staging names with one self-signed leaf certificate that nobody trusts and nothing
installs; Pangolin reaches it through Newt without verifying it. Make the pair on the staging host, in the folder that
holds `unset-dev-secrets/`, with the host's own OpenSSL (checked with OpenSSL 3.0.13, Ubuntu 24.04's): a P-256 key,
both staging names as SANs, no CA flag, 825 days. The key never leaves the host.

```sh
umask 077
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:staging.unset.sh,DNS:staging.unset.ac\n' \
  > unset-dev-secrets/.leaf.ext
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out unset-dev-secrets/.leaf.key
openssl req -new -key unset-dev-secrets/.leaf.key -subj "/CN=staging.unset.sh" \
  | openssl x509 -req -signkey unset-dev-secrets/.leaf.key -days 825 -out unset-dev-secrets/.leaf.pem \
    -extfile unset-dev-secrets/.leaf.ext
openssl x509 -in unset-dev-secrets/.leaf.pem -noout -enddate
sudo install -o 65532 -g 65532 -m 0400 unset-dev-secrets/.leaf.pem unset-dev-secrets/dev_tls_cert
sudo install -o 65532 -g 65532 -m 0400 unset-dev-secrets/.leaf.key unset-dev-secrets/dev_tls_key
rm unset-dev-secrets/.leaf.ext unset-dev-secrets/.leaf.pem unset-dev-secrets/.leaf.key
```

The `-enddate` line prints the expiry while the deploy user can still read the certificate (after `install` only uid
65532 can); every line runs in a plain `sh`. Put the date 30 days before the expiry in the staging calendar and remake
the pair the same way then (C18 reads only the two files' places, not their dates). Only the edge mounts them (P1.36c).

## Newt's env file (P1.37v, dev only)

Under dev the edge publishes no port: Pangolin reaches it through Newt, a service in `compose.dev.yaml` (ADR 0030,
Decision 2). Newt's credentials go in `unset-dev-env/newt.env`, yours, mode `0600`, beside `pds.env`. Start it from
`deployment/env/newt.example.env`. It holds exactly three names, which the preflight's C31 checks by name only; every
other Newt setting is written out in `compose.dev.yaml`. The local stack has no Newt and reads no `newt.env`.

| Name | Where it comes from |
| --- | --- |
| `PANGOLIN_ENDPOINT` | Pangolin's own `https` address |
| `NEWT_ID` | shown by Pangolin when you create the staging site |
| `NEWT_SECRET` | shown once, with the id; if lost, regenerate it in Pangolin and replace it here |

Each Pangolin target for the two staging names is `https` to the edge's fixed address, `10.250.37.3`, port 443, with
certificate checks off for that target, since the leaf above is self-signed (ADR 0032, Decisions 4 and 5). Set each
resource's **TLS Server Name** to its own staging name, `staging.unset.sh` and `staging.unset.ac`: Pangolin 1.24.0 sends
no SNI to an IP target otherwise, and the edge refuses a handshake without one (ADR 0032 Decision 5). Newt saves its
credentials back to `/tmp` inside its container, which holds nothing after a restart; this file stays the only copy on
the host.

**The staging host itself (ADR 0030 Decision 2).** Containers on `newt_edge` can reach host services listening on that
network's bridge address, `10.250.37.1`, including any bound to `0.0.0.0` (docker/docs d8edfe0
content/manuals/engine/network/port-publishing.md:186-192), until isolated gateway mode removes that address; Newt can
also reach the host and its LAN through `newt_egress`. So three conditions are yours and must hold for as long as
staging runs:

1. The staging host is single-purpose: it runs this stack and nothing else.
2. No container uses host networking unless it is part of this stack.
3. Nobody else's workloads run there.

**After each deploy**, run the check below on the host, which reaches `newt_edge` through that bridge address; it uses
the host's own `sh`, curl, OpenSSL and GNU `date`, and needs no secret. It prints `PASS the staging edge` and ends with
status 0, or prints one `FAIL` line per problem and ends with status 1; a failure stops the deploy. For each staging
name it takes the certificate the edge serves for that name as SNI and checks that it is the one self-signed leaf
(`-check_ss_sig`, since OpenSSL 3.0.13 accepts a broken self-signature without it), with no CA flag, a P-256 key,
exactly the two staging names, at most 825 days of validity and more than 30 days left (`-checkend`: this failure is the
only expiry guard, ADR 0032 Decision 1), and that `:80` answers only an empty `308` to its https URL (caddy v2.11.7
modules/caddyhttp/autohttps.go:229-268). Then it asks the PDS's health route at the edge, and makes one request through
Pangolin to each name. Every network call gives up after 10 seconds (`timeout 10`, `--max-time 10`), so a stalled edge or
Pangolin fails the check instead of hanging the deploy.

```sh
edge=10.250.37.3 failed=0 tmp=$(mktemp -d)
fail() { echo "FAIL $*"; failed=1; }
for name in staging.unset.sh staging.unset.ac; do
  timeout 10 openssl s_client -connect "$edge:443" -servername "$name" </dev/null 2>/dev/null | openssl x509 >"$tmp/$name.pem" 2>/dev/null \
    || { fail "$name: no certificate over TLS"; continue; }
  leaf="$tmp/$name.pem"
  openssl verify -check_ss_sig -CAfile "$leaf" "$leaf" >/dev/null 2>&1 || fail "$name: not a validly self-signed leaf"
  openssl x509 -in "$leaf" -noout -ext basicConstraints | grep -q 'CA:FALSE' || fail "$name: not marked CA:FALSE"
  openssl x509 -in "$leaf" -noout -text | grep -q 'ASN1 OID: prime256v1' || fail "$name: key is not P-256"
  [ "$(openssl x509 -in "$leaf" -noout -ext subjectAltName | tail -n +2 | tr -d ' ')" = "DNS:staging.unset.sh,DNS:staging.unset.ac" ] \
    || fail "$name: names are not exactly the two staging names"
  start=$(date -d "$(openssl x509 -in "$leaf" -noout -startdate | cut -d= -f2)" +%s)
  end=$(date -d "$(openssl x509 -in "$leaf" -noout -enddate | cut -d= -f2)" +%s)
  [ $((end - start)) -le $((825 * 86400)) ] || fail "$name: valid for more than 825 days"
  openssl x509 -in "$leaf" -noout -checkend 2592000 >/dev/null || fail "$name: expires within 30 days; remake the leaf"
  [ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url} %{size_download}' --resolve "$name:80:$edge" "http://$name/")" \
    = "308 https://$name/ 0" ] || fail "$name: :80 is not only an empty 308 to https"
done
cmp -s "$tmp/staging.unset.sh.pem" "$tmp/staging.unset.ac.pem" || fail "the two names are not served one leaf"
[ "$(curl -sS --max-time 10 -k -o /dev/null -w '%{http_code}' --resolve "staging.unset.ac:443:$edge" https://staging.unset.ac/xrpc/_health)" = 200 ] \
  || fail "staging.unset.ac: the PDS health route does not answer 200 at the edge"
for url in https://staging.unset.sh/ https://staging.unset.ac/xrpc/_health; do
  [ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$url")" = 200 ] || fail "$url: no 200 through Pangolin"
done
rm -r "$tmp"
[ "$failed" = 0 ] && echo "PASS the staging edge"
```

If the only failure is the expiry, remake the leaf as above, then deploy and run the check again.

## The first invite codes (one-off, until P2.09)

Invites are required (`PDS_INVITE_REQUIRED`). Until `interfaces/pds-admin` (P2.09) exists, Alex makes each code by hand
with this one-off; Claude never runs it. It is retired, and this section removed, when P2.09 lands. All four
conditions hold every time:

1. It runs with `docker compose exec` inside the PDS container, against the PDS's own loopback port. No port is
   published, and the edge still answers 404 for `createInviteCode` (`deployment/edge/snippets/xrpc-guard.caddy`).
2. The admin password is read inside the container from the PDS's own environment, never typed on a command line and
   never printed: the single quotes below keep your shell from expanding anything.
3. Each code has `useCount` 1 and goes to one tester.
4. Your log line records the date and the number of codes, never a code.

From the checkout, with the same files the wrapper passes (`deployment/preflight/stack.ts`); `exec` starts nothing and
is the one `docker compose` command this runbook allows by hand:

```sh
docker compose -f deployment/compose.dev.yaml --env-file ../unset-dev-env/dev-public.env exec pds node -e 'fetch("http://127.0.0.1:3000/xrpc/com.atproto.server.createInviteCode", { method: "POST", headers: { authorization: "Basic " + Buffer.from("admin:" + process.env.PDS_ADMIN_PASSWORD).toString("base64"), "content-type": "application/json" }, body: JSON.stringify({ useCount: 1 }) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || typeof j.code !== "string") { console.error("no invite code: HTTP " + r.status); process.exit(1); } console.log(j.code); })'
```

If the PDS refuses the request (a wrong admin password, say), the command prints only the HTTP status and exits
non-zero, so a failure never looks like a code. The request is the one the PDS's own `pdsadmin create-invite-code`
sends (bluesky-social/pds v0.4.5037 `pdsadmin/create-invite-code.sh`), aimed at loopback instead of the public name.
The code it prints goes to the tester and nowhere else.

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
inside the containers. The preflight does not detect rootless Docker, so use the root daemon.

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
install -d -m 0755 unset-dev-trust
install -m 0644 unset-dev-ca/root.pem unset-dev-trust/root.pem
```

`unset-dev-trust/` holds only that copy of the root's public certificate, which P1.34d binds into pds and web; it is
never the CA folder, the env folder or the secrets folder. Copy it, never link it, and put nothing else there. The two
`install` lines can be run again after you remake the root: `install -d` accepts the folder that is already there, and
`install` replaces whatever sits at `root.pem`, a link included, instead of writing through it. The preflight refuses
the folder unless it and `root.pem` are yours (or root's), nobody else can write the folder, and `root.pem` is 0444 or
0644.

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

## Installing cosign (P2.26b, dev and prod)

C3 and C4 verify every image in `deployment/images.lock.json` with cosign v3.1.3 at `/usr/local/bin/cosign`, offline
against the committed `deployment/sigstore/trusted_root.json`. The preflight hashes that file first and fails both
checks unless it is the pinned linux amd64 binary (`deployment/preflight/cosign.ts`); a cosign anywhere else on `PATH`
is never run. Our images are built for linux/amd64 only, so the deploy host is amd64. Install it once per host, and
again for each cosign bump. Run it in bash, since dash, the `sh` on Debian and Ubuntu, has no `pipefail`:

```sh
(
  set -euo pipefail
  dir="$(mktemp -d)"
  trap 'rm -rf -- "$dir"' EXIT
  curl -fsSLo "$dir/cosign" https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64
  echo "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71  $dir/cosign" | sha256sum -c -
  sudo install -o root -g root -m 0755 "$dir/cosign" /usr/local/bin/cosign
)
```

The sum is the one in v3.1.3's `cosign_checksums.txt` and in the workflows. The subshell stops at the first failing
command, so a failed download or a sum that does not match installs nothing; the private temporary folder is removed
either way. If it stops, report it.

## Starting and stopping

Docker Desktop is not supported; use the native Docker Engine on Linux. The wrapper talks only to a Docker socket on
this machine and refuses a daemon that names another host, which Docker Desktop's VM does (architecture record
2026-10-12-workspace-imports-and-remote-daemon, Amendment 3).

Only through the wrapper, which runs the preflight first with the same files (P1.27w):

```sh
npm run dev:up
npm run dev:down
```

To run what the checkout holds instead of the lock's images (P1.37y, ADR 0036), staging only:

```sh
npm run dev:source:up
npm run dev:source:down
```

It builds the five first-party images on the VM, so the preflight's last line says `SOURCE built from the checkout,
unsigned`. Builds fill the disk over time (the reason rule 23 forbade them); when `df -h /` runs low, prune the
builder cache with `docker builder prune -f`, which touches no volume. Commit and push what you tried afterwards;
main still changes only by PR.

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
