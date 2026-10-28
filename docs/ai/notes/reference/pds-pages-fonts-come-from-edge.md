---
id: pds-pages-fonts-come-from-edge
type: reference
status: current
areas: ["[[pds]]", "[[deployment]]"]
summary: The PDS sign-in pages cannot load our fonts by themselves; the edge must serve them and widen only the HTML CSP.
code: [deployment/edge]
sources: [https://www.npmjs.com/package/@atproto/oauth-provider/v/0.23.1, https://caddyserver.com/docs/caddyfile/directives/header, https://github.com/Undefined6799/unset/actions/runs/39781097971]
importance: high
related: ["[[pds]]", "[[deployment]]"]
replaced_by: null
tags: [reference, pds, deployment]
checked: 2026-10-28
---
# PDS sign-in pages get their fonts from the edge (P2.24d spike)

Read from `@atproto/oauth-provider` 0.23.1 (the version inside the pinned PDS 0.4.5037 image, ADR 0027) and Caddy
v2.11.7 (`modules/caddyhttp/headers/caddyfile.go` and `headers.go`).

**What the PDS does.**
- `dist/lib/write-html.js` writes each page's CSP with `default-src 'none'` and no `font-src`. The shape we saw:
  `upgrade-insecure-requests; connect-src 'self'; default-src 'none'; frame-ancestors 'none'; img-src https:;
  script-src 'sha256-…' 'self'; style-src 'self'`. A webfont is blocked by `default-src 'none'`.
- `dist/router/assets/assets-manifest.js:37` serves an asset only when `Sec-Fetch-Dest` is empty, `document`,
  `style` or `script`. A browser fetches a font with `font`, so the PDS cannot serve a font file even if the
  replaced UI dist ships one. Changing either is outside ADR 0027 (only the UI dist may differ).

**What works (proven).** The edge serves the woff2 files from one fixed same-origin path and appends one
`font-src` for that path to HTML responses only. Spike branch `claude/p224d-font-spike` at 356cb7a7 (never
merged), run 39781097971: green in chromium, firefox and webkit against the real pinned PDS image behind
caddy 2.11.7. It checked:
- the CSP gains exactly one `font-src https://<host>/_unset/fonts/`, and every upstream directive and hash stays;
- the font loads and applies;
- fonts from another origin, from `/xrpc/_health`, from `/_unset/fonts-other/` and as `data:` stay blocked;
- non-HTML responses keep their headers unchanged;
- the font path serves only `^/[A-Za-z0-9-]+\.woff2$` with `font/woff2` and `nosniff`; anything else is 404.

The Caddy shape: a `header { match { header Content-Type text/html* } >Content-Security-Policy "^(.+)$"
"$1; font-src …" }` block before `reverse_proxy`. `>` defers the regex replace to response write time, so it sees
the upstream's header. A response without a CSP gets none added. A `handle_path /_unset/fonts/*` block runs
`file_server` from the fonts folder.

**Caveat.** With no PLC reachable, the spike's PDS pages answered 400 with the native error page. That page is
written by the same `write-html.js`, so the CSP shape is the same as on the sign-in page. Re-check on the real
sign-in page once staging runs the new edge.

**Rule.** Do not ask the PDS to serve fonts or relax its CSP. Fonts are an edge concern (P2.24e).

**Edge Dockerfile rules (P1.34j).** `edge.test.ts#edge_dockerfile_only_what_the_rules_read` refuses any `--mount`,
heredoc, parser directive or non-ASCII byte, and pins the only build-stage copy to the Caddy binary. Fonts reach the
image only through a plain `COPY` from the build context, never through a builder stage.

Re-checked at P1.27h (#691), which changed only the edge image tests' docker budgets and helper; the font path, the
CSP rule and the Caddy shape above are unchanged.
