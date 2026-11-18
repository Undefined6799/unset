---
id: indexer
type: area
status: current
areas: ["[[indexer]]"]
summary: "Hub for interfaces/indexer: reads records from the network through Tap; folder not created yet."
code: []
sources: []
importance: normal
related: ["[[http]]", "[[postgres]]"]
replaced_by: null
tags: [area, indexer]
checked: 2026-10-28
---
# indexer

**What it owns.** The process that reads atproto records from the network (the Tap consumer) and writes the `idx`
tables. Everything in `idx` can be dropped and rebuilt from the network (DA-1), so no fact we decide lives there.

**Today.** No folder. The health-only stub was removed (P1.04 cleanup, 2026-10-28) until its first real step
lands (decision 34: folders appear with their first code). When it lands it gets its own entry point (the Hono server
kit in `shared/http` is gone): `main.ts` reads the config once and starts; `compose.ts` is the composition root and the only
file that builds adapters (AB-2); `config.ts` holds its typed keys. Hono's `routes.manifest.json` went with interfaces/http (P1.20k), so
this process needs its own check that every route names a rate-limit policy (SE-4 row, docs/human/architecture.md).

**Links.** [[http]], [[postgres]].
