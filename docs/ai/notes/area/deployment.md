---
id: deployment
type: area
status: current
areas: ["[[deployment]]"]
summary: "Hub for deployment/: compose, edge, preflight, and the local precheck that never creates accounts."
code: [deployment/postgres/init/00-bootstrap.sh, deployment/reserved-labels.txt, deployment/preflight/stack.ts, scripts/dev-precheck.ts]
sources: []
importance: normal
related: ["[[postgres]]"]
replaced_by: null
tags: [area, deployment]
checked: 2026-10-27
---
# deployment

**What it owns.** What puts the system on machines: Compose, edge, backup and preflight, as each lands.

**Today.**
- `postgres/init/00-bootstrap.sh`: runs once at initdb as the bootstrap superuser and creates only `migrator`,
  `tap`, their databases and the PUBLIC revokes. Every other role comes from migrations. Trusted base.
- `reserved-labels.txt`: handle labels no account may take; pds-admin enforces it at P2.09.
- `preflight/`: checks a stack before `compose up` (P1.30). It parses Compose itself. CI runs Compose 2.38.2
  (compose-go v2.7.1) and the host runs v5.3.1 (compose-go v2.13.0). compose-go's `template/` package (interpolation)
  changed between those two versions (ddb94f1 "fix: avoid eager default interpolation", aa1ee1a "fix extraction of
  variables"; `git log v2.7.1..v2.13.0 -- template/`), which is the kind of change P1.30l's revisit trigger watches
  for.
- `scripts/dev-precheck.ts` (P1.29s): `dev:up` / `local:up` run it before compose up. It refuses a production PDS host
  (`unset.ac`) and a foreign describeServer DID, then the preflight. It creates no account and writes no `.seeded.json`.
  P1.29t's stack tests refuse to probe under `dev`; `dev:up` still has no client_id probe child.
- `dev:up` runs `up -d --no-build` (P1.37n): dev runs the registry images C2 pinned, and C2 fails any service
  with a `build:` under dev and prod, even beside a locked digest. Only `local:up` keeps `--build`, and
  `dev:source:up` (P1.37y, ADR 0036): `compose.dev.source.yaml` under `--env dev --source` builds the five
  first-party services from the checkout on staging; C2 admits a build C26 passes, the run ends with a fixed
  `SOURCE` line, and the flag is refused under prod and local.
- `preflight/stack.ts` waits for a daemon still starting before anything runs (P1.37u): it asks `docker info` for up
  to 60 s in all, each try killed at 10 s, and only no answer or a refused connection waits. Any answer, a remote
  daemon included, is judged at once; after the bound it fails with `docker did not answer in time (waited 60 s)`.

Production deploys only CI-built images of merged commits; staging may build from its checkout (ADR 0036). Terraform
and Ansible arrive at P5.00, once hosting is chosen.

**Links.** [[postgres]].
