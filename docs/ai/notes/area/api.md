---
id: api
type: area
status: current
areas: ["[[api]]"]
summary: "Hub for interfaces/api: the public read API process with its own database role; today a health-only server."
code: [interfaces/api/compose.ts]
sources: []
importance: normal
related: ["[[http]]", "[[postgres]]"]
replaced_by: null
tags: [area, api]
checked: 2026-10-06
---
# api

**What it owns.** The public read API. It runs as its own process with its own Postgres role, `api`, which reads
the index tables and nothing it does not need (`infrastructure/postgres/roles.json`).

**Today.** A server-kit server with `/health` only. Every server is built the same way from the server kit in `shared/http` (see [[http]]): `main.ts` reads
the config once and starts; `compose.ts` is the composition root and the only file that builds adapters (AB-2);
`config.ts` merges the kit's keys; `routes.manifest.json` lists every route with its group, limits and middleware,
and a guard checks it against the code.

**How data will flow.** Request → kit checks → a domain read → a view type out (SE-3). It never writes.

**Links.** [[http]], [[postgres]].
