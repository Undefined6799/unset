---
id: review
type: area
status: current
areas: ["[[review]]"]
summary: "Hub for interfaces/review: the picture review process that decodes uploads in child processes with no network."
code: [interfaces/review/main.ts, interfaces/review/compose.ts]
sources: []
importance: normal
related: ["[[http]]"]
replaced_by: null
tags: [area, review]
checked: 2026-11-21
---
# review

**What it owns.** Upload checks before anything is published (architecture guideline §1). It is meant to split into
a compute part with no network and a separate review-egress part, so the code that parses uploads cannot reach out.

**Today (P2.17, #1828; wired in #1833).** `interfaces/review/` is its own package, process and image
(`deployment/images/review.Dockerfile`). `main.ts` reads the config once (exit 78 when invalid), then starts the child
pool and its door, logging each answer by outcome and each pool event by name only (SE-7). `compose.ts` is the
composition root: it builds `createImagePool` from `infrastructure/image`, which decodes member pictures in killable
child processes, and `reviewListener` in front of it; review holds no secret, no database pool and no outbound
client. Only web calls it, through net-guard's `review` policy (`interfaces/web/src/lib/server/compose.ts`). The
Compose service `review` is in `deployment/compose.dev.source.yaml` and `deployment/compose.local.yaml`
(`SOURCE_ONLY_SERVICES` in `deployment/preflight/local-only.ts`), not in `compose.dev.yaml`. It joins `review_web`
alone, so it has no route out.

**Links.** [[http]].
