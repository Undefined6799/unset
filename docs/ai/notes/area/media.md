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
lands (decision 34: folders appear with their first code). When it lands it is built like [[http]] from the server
kit in `shared/http`: `main.ts` reads the config once and starts; `compose.ts` is the composition root and the only
file that builds adapters (AB-2); `config.ts` merges the kit's keys; `routes.manifest.json` lists every route.

**How data will flow.** Browser → media proxy → the owner's PDS through [[net-guard]] → checked bytes back.

**Links.** [[http]], [[net-guard]].
