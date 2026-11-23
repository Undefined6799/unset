# Chat servers: secrets and databases (staging)

The chat servers are Synapse and MAS (ADR 0098). Their config files are `deployment/chat/dev/homeserver.yaml`,
`log.yaml` and `mas.yaml`, and preflight C36 refuses a stack that changes a reviewed value. Those files hold only paths
under `/run/secrets`. This page makes the files behind those paths, once, before the chat services first start.

The files live in `unset-dev-secrets/` with the rest (`dev-stack-secrets.md`, "Where the folder lives" and "Layout"):
mode `0400`, each owned by the one uid that reads it. A value two services need is two files.

## Who reads what

| File | Owner (uid:gid) | Read by | Holds |
| --- | --- | --- | --- |
| `pg_synapse_password` | `999:999` | postgres | the `synapse` role's password, for `chat-databases.sh` |
| `pg_mas_password` | `999:999` | postgres | the `mas` role's password, for `chat-databases.sh` |
| `synapse_pgpass` | `991:991` | synapse | one libpq passfile line with the same `synapse` password |
| `synapse_signing_key` | `991:991` | synapse | its event signing key; never replaced while the database lives |
| `synapse_macaroon_secret_key` | `991:991` | synapse | 64 hex characters |
| `synapse_form_secret` | `991:991` | synapse | 64 hex characters |
| `synapse_mas_secret` | `991:991` | synapse | the secret Synapse and MAS share, 64 hex characters |
| `mas_synapse_secret` | `65532:65532` | mas | the same shared secret, MAS's copy |
| `mas_pg_password` | `65532:65532` | mas | the same `mas` password, to log in |
| `mas_encryption` | `65532:65532` | mas | 64 hex characters; never changed after the first start |
| `mas_signing_key` | `65532:65532` | mas | an RSA private key, PKCS#8 PEM |
| `mas_chat_admin_client_secret` | `65532:65532` | mas | chat-admin's client secret |
| `chat_admin_client_secret` | `65532:65532` | chat-admin | the same client secret, chat-admin's copy |
| `chat_admin_keys` | `65532:65532` | chat-admin | the public keys allowed to sign its commands: web's (`web-chat`) and the door's (`door-chat`) |
| `chat_auth_seal_keyring` | `65532:65532` | chat-auth | the door's own seal keyring, for the browser list's lock keys |
| `chat_auth_chat_admin_key` | `65532:65532` | chat-auth | the door's Ed25519 private key (PKCS#8 PEM), kid `door-chat`, which may only end sessions |
| `pg_chat_auth_password` | `65532:65532` | migrate, chat-auth | the `chat_auth` role's password; migrate sets it in every stack (`roles.json`) |

Synapse runs as `991` (our image's `USER`, `deployment/images/synapse.Dockerfile`, upstream's default uid) and MAS as
`65532` (its distroless `nonroot` base, `Dockerfile:200` at v1.29.0).

## Make the files

Run in `unset-dev-secrets/` under `umask 077`. No command prints a value. Each random value is written with no
trailing newline (`tr -d '\n'`, as in `dev-stack-secrets.md`): MAS refuses an `encryption_file` that holds one
(staging, 2026-11-23).

```sh
umask 077
openssl rand -hex 32 | tr -d '\n' > pg_synapse_password
openssl rand -hex 32 | tr -d '\n' > pg_mas_password
cp pg_mas_password mas_pg_password
# libpq ignores a passfile that its group or others can read (PostgreSQL 18 libpq docs, "The Password File").
printf 'postgres:5432:synapse:synapse:%s\n' "$(cat pg_synapse_password)" > synapse_pgpass
docker run --rm --network none --entrypoint /opt/synapse/bin/generate_signing_key <the locked Synapse image> > synapse_signing_key
openssl rand -hex 32 | tr -d '\n' > synapse_macaroon_secret_key
openssl rand -hex 32 | tr -d '\n' > synapse_form_secret
openssl rand -hex 32 | tr -d '\n' > synapse_mas_secret
cp synapse_mas_secret mas_synapse_secret
openssl rand -hex 32 | tr -d '\n' > mas_encryption
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out mas_signing_key
openssl rand -hex 32 | tr -d '\n' > mas_chat_admin_client_secret
chown 999:999 pg_synapse_password pg_mas_password
chown 991:991 synapse_pgpass synapse_signing_key synapse_macaroon_secret_key synapse_form_secret synapse_mas_secret
chown 65532:65532 mas_synapse_secret mas_pg_password mas_encryption mas_signing_key mas_chat_admin_client_secret
chmod 0400 pg_synapse_password pg_mas_password synapse_* mas_*
```

`generate_signing_key` ships in the Synapse image's venv (`pyproject.toml:234` at v1.165.0) and writes one `ed25519` key.
MAS needs at least one RSA key (`docs/reference/configuration.md`, "Signing Keys", at v1.29.0).

The door's and chat-admin's files, in the same folder (`web_chat_admin_key` is made in `dev-stack-secrets.md`; its
public half goes into `chat_admin_keys` here):

```sh
umask 077
cp mas_chat_admin_client_secret chat_admin_client_secret
openssl rand -base64 32 | tr -d '\n' > pg_chat_auth_password
printf '{"active":"k1","keys":{"k1":"%s"}}' "$(openssl rand -base64 32)" > chat_auth_seal_keyring
node -e 'const c = require("node:crypto"), fs = require("node:fs");
  const door = c.generateKeyPairSync("ed25519");
  fs.writeFileSync("chat_auth_chat_admin_key", door.privateKey.export({ type: "pkcs8", format: "pem" }));
  const pub = (key) => key.export({ type: "spki", format: "pem" });
  const web = c.createPublicKey(fs.readFileSync("web_chat_admin_key"));
  fs.writeFileSync("chat_admin_keys", JSON.stringify([
    { kid: "web-chat", iss: "web", verbs: ["account.create", "session.mint", "session.end", "account.lock",
      "account.unlock", "account.deactivate", "rooms.sweep"], publicKeyPem: pub(web) },
    { kid: "door-chat", iss: "door", verbs: ["session.end"], publicKeyPem: pub(door.publicKey) }]));'
chown 65532:65532 chat_admin_client_secret chat_admin_keys chat_auth_seal_keyring chat_auth_chat_admin_key pg_chat_auth_password
chmod 0400 chat_admin_client_secret chat_admin_keys chat_auth_seal_keyring chat_auth_chat_admin_key pg_chat_auth_password
```

web's verbs are the ones chat-admin lets `web` sign (`interfaces/chat-admin/envelope.ts`, `ISSUER_VERBS`); a verb
outside that list stops chat-admin at boot. `pg_chat_auth_password` is mounted by migrate under every stack, so it must
exist before the next `dev:up` too.

## Make the databases, once

The staging cluster already exists, so its initdb scripts will not run again. With the postgres service mounting
`pg_synapse_password` and `pg_mas_password`, run from the checkout:

```sh
docker compose -p unset-dev exec -T -u postgres postgres bash -s < deployment/postgres/chat/chat-databases.sh
```

It makes the `synapse` and `mas` roles, each owning its own database (`synapse` in the C collation Synapse requires),
and revokes PUBLIC from both. It can run again: it changes nothing but each role's password, which it sets from its
file, so rotating a password is a new file and a second run (then restart the server that logs in with it).

## Check it worked

`docker compose -p unset-dev exec -u postgres postgres psql -Atc "SELECT datname, pg_get_userbyid(datdba), datcollate
FROM pg_database WHERE datname IN ('synapse','mas')"` prints `synapse|synapse|C` and `mas|mas|...`.

## Start the chat services

The chat services run on staging from the checkout only (`npm run dev:source:up`, `deployment/compose.dev.source.yaml`;
local-only.ts `CHAT_SERVICES`). Before the first start:

1. The mirror must hold the Python base and MAS (`deployment/mirror.list.json`; `mirror.yml` copies and signs them on a
   push to main), and `deployment/images.lock.json` must name MAS's mirror digest, or C2 refuses `mas`.
2. The files above and the two databases exist.
3. `staging.unset.cc` is published through Pangolin with a bypass for everyone (ADR 0115 decision 5; Alex's card
   2026-11-23 04:15Z, "Pangolin bypass for everyone"; before that ADR 0105 had it behind the login). The chat box
   framed on `staging.unset.sh` cannot carry Pangolin's `SameSite=Lax` login cookie, so chat's own sign-in through
   unset.sh, which stays behind the login, is the only gate. The source stack's edge serves it from `deployment/edge/dev/chat.caddy`:
   `/_matrix/client/` to Synapse's client listener, the door's routes to the door, the edge's 404 for anything else.
   Once, before the first start:
   1. **DNS.** Add a record for `staging.unset.cc` of the same type and value as the one `staging.unset.sh` has, so it
      points at Pangolin, and add `CAA 0 issue "letsencrypt.org; validationmethods=http-01"` beside its three CAA
      records (ADR 0025), so Pangolin can get its own certificate for it.
   2. **Pangolin.** Add a resource `staging.unset.cc` on the staging site, set up like `staging.unset.sh`
      (`dev-stack-secrets.md`, "Newt's env file"): one target, `https` to `10.250.37.3` port 443, certificate check off
      for the target, **TLS Server Name** `staging.unset.cc`, and a bypass rule for everyone on the resource. The edge
      routes only the door's paths and `/_matrix/client/` on this name; everything else is the edge's 404.
   3. **The dev leaf.** Remake the edge's self-signed leaf with `staging.unset.cc` as its fourth name
      (`dev-stack-secrets.md`, "The dev edge's self-signed leaf"); a site name the leaf does not cover would make the
      edge ask a public CA.
   4. After the deploy, run that runbook's after-deploy check; it now checks the chat site's routes at the edge.


## Before upgrading Synapse or matrix-js-sdk

The offline device (ADR 0113) uses MSC3814 by its unstable name on both sides: Synapse's
`experimental_features.msc3814_enabled` and its `/unstable/org.matrix.msc3814.v1/dehydrated_device` routes, and the
SDK's `UnstablePrefix` calls. If an upgrade renames either one, the page finds no offline device and quietly goes on
without it. Preflight C36 still passes, because Synapse ignores experimental keys it does not know. Before such an
upgrade, read both release notes for MSC3814, and check that `chat_e2e.first_message_no_browser` in
`tests/e2e/chat-two-browsers.chromium.spec.ts` passed on the upgrade's CI run.
