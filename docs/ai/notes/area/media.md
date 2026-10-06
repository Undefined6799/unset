---
id: media
type: area
status: current
areas: ["[[media]]"]
summary: "Hub for interfaces/media: the media proxy on its own domain, so browsers never see raw getBlob URLs."
code: [interfaces/media/compose.ts]
sources: []
importance: normal
related: ["[[http]]", "[[net-guard]]"]
replaced_by: null
tags: [area, media]
checked: 2026-10-06
---
# media

**What it owns.** The media proxy. Browsers get media only through it, never through a raw `getBlob` URL (CLAUDE.md
"Blobs"). It runs on the media domain, apart from the app origin.

**Today.** A server-kit server with `/health` only. Every server is built the same way from the server kit in `shared/http` (see [[http]]): `main.ts` reads
the config once and starts; `compose.ts` is the composition root and the only file that builds adapters (AB-2);
`config.ts` merges the kit's keys; `routes.manifest.json` lists every route with its group, limits and middleware,
and a guard checks it against the code.

**How data will flow.** Browser → media proxy → the owner's PDS through [[net-guard]] → checked bytes back.

**Links.** [[http]], [[net-guard]].
