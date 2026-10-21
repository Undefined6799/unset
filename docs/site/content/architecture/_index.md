---
title: Architecture
---

What the system optimises for, and the shape of the code that is in the tree.

The order is security and privacy, then evolvability by AI authors, then operational simplicity on one host. The statement and the rule table, including which check fails CI, stay in [`docs/human/architecture.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md). Accepted decisions stay in [`docs/human/decisions/`](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/README.md); this section links them.

## Shape

`apps/web` is the only app folder. A request enters one process under `interfaces/`. The dev and local stacks run `interfaces/http` (`node interfaces/http/main.ts` in `deployment/images/node-app.Dockerfile`). That process calls product rules in `domains/` and reaches Postgres, the PDS and the public network through `infrastructure/`. The only domain folder is `domains/identity`.

| Page | Covers |
| --- | --- |
| [Processes](processes.md) | Compose services, database roles, networks |
| [Layers](layers.md) | Apps, interfaces, domains, infrastructure, and the import allowlist |
| [Data flow](data-flow.md) | One signed-in request; Postgres and the PDS |
| [Trust boundaries](trust-boundaries.md) | Edge, one process per container, egress, trusted base |
| [Security model](security-model.md) | Sessions, CSRF, rate limits, headers, logs |
| [Decisions](decisions.md) | The ADR index |
