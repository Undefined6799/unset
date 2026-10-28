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
lands (decision 34: folders appear with their first code). When it lands it is built like [[http]] from the server
kit in `shared/http`: `main.ts` reads the config once and starts; `compose.ts` is the composition root and the only
file that builds adapters (AB-2); `config.ts` merges the kit's keys; `routes.manifest.json` lists every route.

**Links.** [[http]].
