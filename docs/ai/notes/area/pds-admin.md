---
id: pds-admin
type: area
status: current
areas: ["[[pds-admin]]"]
summary: "Hub for interfaces/pds-admin: sole holder of the PDS admin password, issues member invites for web."
code: [interfaces/pds-admin/main.ts, interfaces/pds-admin/server.ts, interfaces/pds-admin/config.ts, deployment/images/pds-admin.Dockerfile]
sources: [docs/human/decisions/0060-pds-admin-issues-member-invites.md]
importance: normal
related: ["[[web]]", "[[pds]]"]
replaced_by: null
tags: [area, pds-admin]
checked: 2026-11-20
---
# pds-admin

**What it owns.** The only process that holds the PDS admin password (P2.09, ADR 0060, still Proposed). Its one job
today is issuing member invite codes when `web` asks. It imports only its own folder, Node built-ins and
`shared/admin-envelope/` (the zero-dependency allowlist, dependency-cruiser).

**Shape.** `main.ts` reads the config once and serves; any boot failure prints the setting's name, never its value,
and exits 1. `compose.ts` builds the adapters. `config.ts` holds the typed keys (`SIGNUPS_OPEN`,
`INVITE_WINDOW_HOURS`, `INVITE_MAX_PER_WINDOW`, `INVITE_MAX_PER_DAY_GLOBAL`) and reads secrets from files only
(`pds_admin_keys`, `pds_admin_log_key`, `pds_admin_password`). `server.ts` answers `GET /health` and
`POST /v1/invite.issue`; every other method and path is 404.

**How a request flows.** `web` signs an envelope with its Ed25519 key (`shared/admin-envelope` canonicalises it).
`envelope.ts` checks shape, key, signature and claims; `jti.ts` burns the `jti` durably before any PDS call, so a
replay or a crash never issues twice; `issue.ts` checks sign-ups are open, the inviter is ours and in good standing,
and both quotas (`quota.ts`) hold; `pds.ts` then calls the PDS. `pds.ts` is the only file that opens a connection,
only to the internal PDS origin checked at boot, and is the egress guard's single file exemption.

**Log.** `log.ts` writes one fsynced, hash-chained line per outcome; DIDs and codes are HMACs under the log key, so
the log holds nothing `eraseDid` must reach. `cli.ts verify-log` checks the chain; `cli.ts check-reserved` reports
whether each reserved handle label is taken on our PDS.

**Links.** [[web]] (the Invite page is the caller), [[pds]], runbook "The web key pair" in `docs/human/runbooks/dev-stack-secrets.md`.
