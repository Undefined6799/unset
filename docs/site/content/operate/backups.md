---
title: Backups
weight: 4
---

Backup tooling is (planned, Phase 5). `deployment/backup/` is not on the tree. No workflow under `.github/workflows/` is named `backup-freshness`.

| Name | Where it is written | On this tree |
| --- | --- | --- |
| Backup scripts | [Guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md) says `deployment/` holds what puts the system on machines, backup scripts included. | No backup folder. |
| `deployment/backup/` and `.github/workflows/backup-freshness.yml` | [P5.04](https://github.com/Undefined6799/unset/blob/main/docs/ai/book/phase-5.md) in the step book. The step names the workflow as P5.04q and the folder as this step. | Neither path. |
| Backup provider | [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md) decision 14: hosting is decided later, by Phase 5, and the backup provider waits with it. | The [RoPA](https://github.com/Undefined6799/unset/blob/main/docs/human/compliance/ropa.md) Backups row says the storage host is not chosen yet, and its status is `open`, step `P5.04`. |
| Terraform and Ansible | ADR 0001 says they live under `deployment/` only at P5.00. Guideline §1 adds `deployment/terraform/` and `deployment/ansible/` at P5.00, when hosting is chosen. | Neither folder. |

The dev stack page is [Dev stack](../dev-stack/). It does not start a backup job.
