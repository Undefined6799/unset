---
id: media
type: area
status: current
areas: ["[[media]]"]
summary: "Hub for interfaces/media: the media process on its own domain, serving signed draft links from the object store."
code: [interfaces/media/main.ts, interfaces/media/compose.ts, interfaces/media/serve.ts]
sources: []
importance: normal
related: ["[[http]]", "[[net-guard]]"]
replaced_by: null
tags: [area, media]
checked: 2026-11-21
---
# media

**What it owns.** The media proxy. Browsers get media only through it, never through a raw `getBlob` URL (CLAUDE.md
"Blobs"). It runs on the media domain, apart from the app origin.

**Today (P2.19, #1848).** `interfaces/media/` is its own package and process. `main.ts` reads the config once
(exit 78 when invalid), starts a plain Node HTTP server and logs each answer by route template and status only (SE-7).
`compose.ts` is the composition root: it builds the object store's read through [[net-guard]] with a 5 s timeout and
nothing else. `serve.ts` is the door: `GET|HEAD /o/<purpose>/<key>` for a signed draft link (checked by
`verifyDraftPath` from `domains/content`) and `GET /health`; anything else is 404, other methods 405. It reads and sets
no cookie, and every answer carries the sandbox headers (`default-src 'none'; sandbox`, `nosniff`). No Compose stack
runs it on main yet.

**How data flows.** Browser → signed link → media → the object store through [[net-guard]] → the stored version back.

**Links.** [[http]], [[net-guard]].
