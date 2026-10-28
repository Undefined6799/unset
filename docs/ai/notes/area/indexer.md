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
lands (decision 34: folders appear with their first code). When it lands it is built like [[http]] from the server
kit in `shared/http`: `main.ts` reads the config once and starts; `compose.ts` is the composition root and the only
file that builds adapters (AB-2); `config.ts` merges the kit's keys; `routes.manifest.json` lists every route.

**Links.** [[http]], [[postgres]].
