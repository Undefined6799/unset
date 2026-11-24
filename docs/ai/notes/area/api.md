---
id: api
type: area
status: current
areas: ["[[api]]"]
summary: "Hub for interfaces/api: the public read API process with its own database role; folder not created yet."
code: []
sources: []
importance: normal
related: ["[[http]]", "[[postgres]]"]
replaced_by: null
tags: [area, api]
checked: 2026-11-21
---
# api

**What it owns.** The public read API. It runs as its own process with its own Postgres role, `api`, which reads
the index tables and nothing it does not need (`infrastructure/postgres/roles.json`).

**Today.** No folder. The health-only stub was removed (P1.04 cleanup, 2026-10-28) until its first real step
lands (decision 34: folders appear with their first code). When it lands it gets its own entry point, like
`interfaces/review` and `interfaces/media`: `main.ts` reads the config once and starts; `compose.ts` is the composition
root and the only file that builds adapters (AB-2); `config.ts` holds its typed keys. The Hono route manifest was deleted
with the Hono server (P1.20k), so this process needs its own check that every route names a rate-limit policy (SE-4
row, docs/human/architecture.md).

**How data will flow.** Request → kit checks → a domain read → a view type out (SE-3). It never writes.

**Links.** [[http]], [[postgres]].
