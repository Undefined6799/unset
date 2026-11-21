---
title: Runbooks
weight: 2
---

Index of `docs/human/runbooks/`. The pages below link the files. They do not copy the procedures.

`.github/CODEOWNERS` assigns `/docs/human/runbooks/` to `@Undefined6799`.

| File | What the file is |
| --- | --- |
| [dev-stack-secrets.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/dev-stack-secrets.md) | Where the secret files and env files live, and how to create them. The commands that pass those paths are on [Dev stack](../dev-stack/). |
| [docs-site.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/docs-site.md) | Publishing this site at `docs.unset.sh` from the staging host: the one-time DNS and Pangolin settings, the build into `docs/site/public` that the staging edge serves, and the check (ADR 0075). |
| [edge-data-volume.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/edge-data-volume.md) | Replacing the edge volume mounted at `/data`. The file says the edge keeps its ACME account and certificate keys there, and its autosaved config under `/config`. |
| [lexicons-mirror-key.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/lexicons-mirror-key.md) | The deploy key `.github/workflows/lexicons-mirror.yml` pushes our lexicons to `unset-sh/lexicons` with: setting it up, rotating it, cutting it off, and bringing a public contribution across with credit (ADR 0089). |
| [object-store.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/object-store.md) | Removing deleted objects for real from the dev and staging object store (delete, purge the metadata log, wait, forced vacuum), taking down one object, and what that does not yet remove. `objects_erase_removes_bytes` in `deployment/images/objects-erasure.image.test.ts` runs the same sequence. |
| [oauth-key-rotation.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/oauth-key-rotation.md) | Rotating the OAuth client keys. `oauthFields` names `OAUTH_CLIENT_KEYS` as a `secretFile` (`infrastructure/pds/oauth/oauth-client.ts`). `shared/config/load.ts` reads a `secretFile` from the environment name formed by the field name plus `_FILE`, so this field's name is `OAUTH_CLIENT_KEYS_FILE`. |
| [pds-blobstore-move.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/pds-blobstore-move.md) | Moving the PDS's blobs from its data volume into the object store's `unset-pds` bucket once, with a backup, a checksum check and the way back (P2.18p). |
| [pds-debug-logging.md](https://github.com/Undefined6799/unset/blob/main/docs/human/runbooks/pds-debug-logging.md) | Turning the PDS process's own request logging on for one session. C12 in `deployment/preflight/checks/pds.ts` fails when `LOG_ENABLED` is set to anything other than the literal `false`. |

Privacy-breach and cybertip procedures live under `docs/human/legal/`. They are linked from [Incidents](../incidents/).
