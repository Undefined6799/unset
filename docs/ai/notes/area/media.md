---
id: media
type: area
status: current
areas: ["[[media]]"]
summary: "Hub for interfaces/media: the media proxy on its own domain; folder not created yet."
code: []
sources: []
importance: normal
related: ["[[http]]", "[[net-guard]]"]
replaced_by: null
tags: [area, media]
checked: 2026-10-28
---
# media

**What it owns.** The media proxy. Browsers get media only through it, never through a raw `getBlob` URL (CLAUDE.md
"Blobs"). It runs on the media domain, apart from the app origin.

**Today.** No folder. The health-only stub was removed (P1.04 cleanup, 2026-10-28) until its first real step
lands (decision 34: folders appear with their first code). When it lands it gets its own entry point (the Hono server
kit in `shared/http` is gone): `main.ts` reads the config once and starts; `compose.ts` is the composition root and the only
file that builds adapters (AB-2); `config.ts` holds its typed keys. Hono's `routes.manifest.json` went with interfaces/http (P1.20k), so
this process needs its own check that every route names a rate-limit policy (SE-4 row, docs/human/architecture.md).

**How data will flow.** Browser → media proxy → the owner's PDS through [[net-guard]] → checked bytes back.

**Links.** [[http]], [[net-guard]].
