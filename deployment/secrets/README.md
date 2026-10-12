# Development stack secrets

**Never run `docker compose down -v` on this stack.** It deletes the Postgres data volume, and from P1.35 on the dev
PDS holds the lexicon authority's account; recovery is P1.34's restore runbook. `npm run dev:down` never passes `-v`.

Everything in this folder except this file is ignored by git. `deployment/compose.dev.yaml` mounts each file below at
`/run/secrets/<name>` in the services listed, and nothing else reads them.

## Layout (architecture record 2026-10-12-c9-secret-file-owner)

Compose bind-mounts a file secret unchanged: the container sees the host file's owner and mode (compose-spec
05-services.md, `secrets`: "uid, gid, and mode attributes are not implemented in Docker Compose when the source of the
secret is a file"). So each file is owned by the numeric uid of the one service that reads it, and this folder is what
keeps every other host account out:

- this folder: mode `0700`, owned by you (the deploy user);
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

Each password is at least 16 bytes (`PG_PASSWORD` and the role files are read as `secretFile({ minBytes: 16 })`).

## Creating or rotating a file

Setting another user as owner needs root once per file. Write the value to a file only you can read, install it, then
remove your copy:

```sh
umask 077
mkdir -p deployment/secrets && chmod 0700 deployment/secrets
openssl rand -base64 32 | tr -d '\n' > /tmp/pw
sudo install -o 999 -g 999 -m 0400 /tmp/pw deployment/secrets/pg_migrator_password
sudo install -o 65532 -g 65532 -m 0400 /tmp/pw deployment/secrets/migrate_pg_password
rm /tmp/pw
```

Rootless Docker is not supported yet: its container uids map to other host uids, so the owners above would be wrong
and the preflight fails closed.

## Until the preflight's secret check is split

Today the preflight's C9 still asks every secret file to be `0600` and owned by you, which a container running as
another uid cannot read. The step that splits C9 by kind (env files stay `0600` and yours; mounted secrets follow the
layout above) waits for Alex's decision; until it lands, the preflight refuses this layout.
