---
id: deployment
type: area
status: current
areas: ["[[deployment]]"]
summary: "Hub for deployment/: the Postgres init script and the reserved handle labels; compose and edge come later."
code: [deployment/postgres/init/00-bootstrap.sh, deployment/reserved-labels.txt]
sources: []
importance: normal
related: ["[[postgres]]"]
replaced_by: null
tags: [area, deployment]
checked: 2026-10-12
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

Deploy only CI-built images of merged commits. Terraform and Ansible arrive at P5.00, once hosting is chosen.

**Links.** [[postgres]].
