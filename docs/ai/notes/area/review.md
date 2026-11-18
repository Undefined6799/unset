---
id: review
type: area
status: current
areas: ["[[review]]"]
summary: "Hub for interfaces/review: the upload checks service (no-network compute, review egress); not created yet."
code: []
sources: []
importance: normal
related: ["[[http]]"]
replaced_by: null
tags: [area, review]
checked: 2026-10-28
---
# review

**What it owns.** Upload checks before anything is published (architecture guideline §1). It is meant to split into
a compute part with no network and a separate review-egress part, so the code that parses uploads cannot reach out.

**Today.** No folder. The health-only stub was removed (P1.04 cleanup, 2026-10-28) until its first real step
lands (decision 34: folders appear with their first code). When it lands it gets its own entry point (the Hono server
kit in `shared/http` is gone): `main.ts` reads the config once and starts; `compose.ts` is the composition root and the only
file that builds adapters (AB-2); `config.ts` holds its typed keys. Hono's `routes.manifest.json` went with interfaces/http (P1.20k), so
this process needs its own check that every route names a rate-limit policy (SE-4 row, docs/human/architecture.md).

**Links.** [[http]].
