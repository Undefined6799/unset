---
title: Operate
type: docs
cascade:
  type: docs
  params:
    reversePagination: false
---

How to run the dev stack, apply migrations, and respond. Human docs stay in `docs/human/` and are linked from these pages. The area pages for the same trees are [Deployment](../areas/deployment/) and [postgres](../areas/infrastructure/postgres/).

| Page | Covers |
| --- | --- |
| [Dev stack](dev-stack/) | `npm run dev:up`, `dev:down`, `local:up`, `local:down`, and the files those scripts pass |
| [Runbooks](runbooks/) | The files in `docs/human/runbooks/` |
| [Migrations](migrations/) | The Compose `migrate` service and `unset-migrate` |
| [Backups](backups/) | (planned, Phase 5) |
| [Incidents](incidents/) | Severity labels and the privacy-breach runbook |

Paths these pages mark planned:

| Path | Record |
| --- | --- |
| `deployment/backup/` | (planned, Phase 5). [Backups](backups/). |
| `deployment/terraform/`, `deployment/ansible/` | (planned, Phase 5). [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md) says Terraform and Ansible live under `deployment/` only at P5.00. [Guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md) adds them at P5.00, when hosting is chosen. |
| `apps/pds/`, `deployment/pds/` | (planned). [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) names both folders. Its status line says implementation and release gates are pending. Neither folder is on the tree. |
