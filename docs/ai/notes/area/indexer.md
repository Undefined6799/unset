---
id: indexer
type: area
status: current
areas: ["[[indexer]]"]
summary: "Hub for interfaces/indexer: reads records from the network through Tap; a health-only server until then."
code: [interfaces/indexer/compose.ts]
sources: []
importance: normal
related: ["[[http]]", "[[postgres]]"]
replaced_by: null
tags: [area, indexer]
checked: 2026-10-06
---
# indexer

**What it owns.** The process that reads atproto records from the network (the Tap consumer) and writes the `idx`
tables. Everything in `idx` can be dropped and rebuilt from the network (DA-1), so no fact we decide lives there.

**Today.** A server-kit server with `/health` only; the Tap consumer lands in a later phase. Every server is built the same way from the server kit in `shared/http` (see [[http]]): `main.ts` reads
the config once and starts; `compose.ts` is the composition root and the only file that builds adapters (AB-2);
`config.ts` merges the kit's keys; `routes.manifest.json` lists every route with its group, limits and middleware,
and a guard checks it against the code.

**Links.** [[http]], [[postgres]].
