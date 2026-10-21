---
title: Architecture
type: docs
weight: 2
cascade:
  type: docs
  params:
    reversePagination: false
---

What the system optimises for, and the shape that is in the tree.

Optimisation order, adopted with the engineering rules (decision 35): security and privacy, then evolvability for AI authors, then operational simplicity on one host. Horizontal scale, multi-region availability and zero-downtime for every change are out of scope until a closed test shows a need ([ADR 0011](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0011-no-orchestrator-until-measured-need.md)). The checked rule table stays in [`docs/human/architecture.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md).

One Compose stack on one host. A request enters one process under `interfaces/`, which calls a product rule under `domains/` and reaches Postgres, the PDS and the public network only through `infrastructure/`. The UI in the tree is `apps/web`. `interfaces/admin` is in the tree and serves `GET /health` only. Decision 34 ([`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md)): a folder appears when its first code lands. Roadmap: [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).

| Page | Covers |
| --- | --- |
| [Processes](processes/) | Containers, database roles, networks |
| [Layers](layers/) | Folders and the import allowlist |
| [Data flow](data-flow/) | One account-page request; Postgres and the PDS |
| [Trust boundaries](trust-boundaries/) | Edge, one process per container, egress, trusted base |
| [Security model](security-model/) | What each check is for |
| [Decisions](decisions/) | ADR index |
