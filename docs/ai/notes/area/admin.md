---
id: admin
type: area
status: current
areas: ["[[admin]]"]
summary: "Hub for interfaces/admin: the admin server, reached only over Tailscale; today a health-only kit server."
code: [interfaces/admin/compose.ts]
sources: []
importance: normal
related: ["[[http]]"]
replaced_by: null
tags: [area, admin]
checked: 2026-10-06
---
# admin

**What it owns.** The admin server's entry point: gate, session, enrolment and admin actions as they land
(architecture guideline §1). Its screens will live in `apps/admin`, which does not exist yet.

**Today.** A server-kit server with `/health` and nothing else. Every server is built the same way from the server kit in `shared/http` (see [[http]]): `main.ts` reads
the config once and starts; `compose.ts` is the composition root and the only file that builds adapters (AB-2);
`config.ts` merges the kit's keys; `routes.manifest.json` lists every route with its group, limits and middleware,
and a guard checks it against the code.

**Differences from the public servers.**
- It sits behind Tailscale with no edge proxy, so the trusted proxy runs in `socket` mode: the client address is the
  socket peer, not a header (plan §5.7, P1.05e).
- The PDS admin password is never here; only `interfaces/pds-admin` (not built yet) may hold it.

**Links.** [[http]].
