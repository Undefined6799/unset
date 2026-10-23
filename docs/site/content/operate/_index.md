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
| [Dev stack](dev-stack/) | `npm run dev:up`, `dev:down`, `dev:source:up`, `dev:source:down`, `local:up`, `local:down`, and the files those scripts pass |
| [Runbooks](runbooks/) | The files in `docs/human/runbooks/` |
| [Migrations](migrations/) | The Compose `migrate` service and `unset-migrate` |
| [Incidents](incidents/) | Severity labels and the privacy-breach runbook |

Roadmap: [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).
