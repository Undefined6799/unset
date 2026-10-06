---
id: review
type: area
status: current
areas: ["[[review]]"]
summary: "Hub for interfaces/review: the upload checks service, split into no-network compute and review egress."
code: [interfaces/review/compose.ts]
sources: []
importance: normal
related: ["[[http]]"]
replaced_by: null
tags: [area, review]
checked: 2026-10-06
---
# review

**What it owns.** Upload checks before anything is published (architecture guideline §1). It is meant to split into
a compute part with no network and a separate review-egress part, so the code that parses uploads cannot reach out.

**Today.** A server-kit server with `/health` only; the checks land in later phases. Every server is built the same way from the server kit in `shared/http` (see [[http]]): `main.ts` reads
the config once and starts; `compose.ts` is the composition root and the only file that builds adapters (AB-2);
`config.ts` merges the kit's keys; `routes.manifest.json` lists every route with its group, limits and middleware,
and a guard checks it against the code.

**Links.** [[http]].
