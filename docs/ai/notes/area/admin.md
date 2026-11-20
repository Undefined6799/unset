---
id: admin
type: area
status: current
areas: ["[[admin]]"]
summary: "Hub for interfaces/admin: the admin server, reached only over Tailscale; folder not created yet."
code: []
sources: []
importance: normal
related: ["[[http]]", "[[pds-admin]]"]
replaced_by: null
tags: [area, admin]
checked: 2026-11-20
---
# admin

**What it owns.** The admin server's entry point: gate, session, enrolment and admin actions as they land
(architecture guideline §1). Its screens will live in `apps/admin`, which does not exist yet.

**Today.** No folder. The health-only stub was removed (P1.04 cleanup, 2026-10-28) until the first admin step
lands (decision 34: folders appear with their first code). When it lands it gets its own entry point (the Hono server
kit in `shared/http` is gone): `main.ts` reads the config once and starts; `compose.ts` is the composition root and the only
file that builds adapters (AB-2); `config.ts` holds its typed keys. Hono's `routes.manifest.json` went with interfaces/http (P1.20k), so
this process needs its own check that every route names a rate-limit policy (SE-4 row, docs/human/architecture.md).

**Differences from the public servers.**
- It sits behind Tailscale with no edge proxy, so the trusted proxy runs in `socket` mode: the client address is the
  socket peer, not a header (plan §5.7, P1.05e).
- The PDS admin password is never here; only `interfaces/pds-admin` holds it ([[pds-admin]]).

**Links.** [[http]].
