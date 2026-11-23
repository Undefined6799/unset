---
id: visitors-behind-one-address
type: reference
status: current
areas: ["[[web]]", "[[deployment]]"]
summary: "Measured P1.22f: three cold visitors per 10 s fit app_files from one address; past that pages read without the client."
code: [deployment/edge/snippets/ratelimit.caddy, deployment/edge/limits.json, tests/e2e/bundle-measure/visitors.ts]
sources: [https://github.com/mholt/caddy-ratelimit/tree/5625512f24f6, https://svelte.dev/docs/kit/page-options#csr]
importance: high
related: ["[[single-vs-split-bundle-at-the-edge]]", "[[web]]", "[[deployment]]"]
replaced_by: null
tags: [reference, web, deployment]
checked: 2026-11-23
---
# Visitors behind one address and the edge's file allowance (P1.22f)

Main 60228f5 (P1.22e: the public profile runs the client) built with `npm run build -w interfaces/web`, served by the
built web in socket mode (`tests/e2e/bundle-measure/serve.ts`, which seeds one public member), behind Caddy 2.11.9
with caddy-ratelimit 5625512f24f6 running the dev app site's own `app-ratelimit` snippet (`edge.caddy`): app_files
120 per 10 s, app_burst 60 per 10 s, app_global 1200 per 5 min, all keyed on one client address. Chromium 1243,
Playwright 1.64.1, unthrottled, every visitor a fresh browser with no cache and no session. Staging was not touched.
Rerun: `node tests/e2e/bundle-measure/visitors.ts <caddy> <out.json>` (its header says how).

**What one visitor's page asks for.**
- Cold `/@handle`: 32 build files in app_files (30 scripts from kit's 30 modulepreload links, the stylesheet, the
  favicon), plus its document and two fonts in app_burst, within half a second. The client takes the page.
- Cold home and cold unmatched address, as on main (no client): 2 build files (the stylesheet, the favicon).
- The same two with the client on (a local what-if, never committed: root `csr = true`, home's policy `client: true`,
  the hook letting kit's policy through on every answer; what P1.22k will do): home 28 files, unmatched 26.
- Warm, any page: no build file. A reload is one document (304, or the 404 again); a new tab is nothing or the
  document. So the allowance is spent by cold visitors only.

**Several visitors behind one address, cold `/@handle`.** Same results with the what-if build.
- 1, 2 or 3 at once: 32, 64, 96 files, nothing refused, every visitor gets the client.
- 4 at once: 128 files, 8 refused, 2 of 4 got the client. 5, 6 or 8 at once: none got the client.
- 10 arriving one a second (a link passed round an office): 3 got the client; 6 of 10 also lost the stylesheet.
- Every visitor still read the page: the server's page with its words and plain links. When the stylesheet was the
  refused file the page was readable but unstyled. A refused file gets Caddy's empty 429, not the Too many tries page
  (that is for navigations only), so no visitor was sent away.
- The next wall: app_global counts every request, so about 34 cold visitors (35 requests each) per 5 minutes per
  address, after which the document itself is refused and the visitor gets the Too many tries page.

**What it means.** 120 per 10 s is three cold public pages. A visitor past that sees the no-script page (ADR 0114's
floor), sometimes unstyled. IPv6 visitors are grouped per /64; IPv4 visitors behind a carrier's shared address are
one key, so on a phone network a few strangers opening any public page in the same 10 s already share it. Changing
the allowance is a loosening of a security control: its own decision with Alex's typed line (ADR 0059). The facts for
it: the files are static, content-hashed and served by adapter-node from a table built at boot, with a year's
immutable caching, before any hook, session or database work (ratelimit.caddy's app_files comment); a raise leaves
app_burst (documents, data, fonts), app_global and web's own limits as they are, so the second wall above stays.
Tests: `deployment/edge/limits.budget.test.ts` (three at once pass; four within 10 s is a named `test.fails`; thirty
spread over five minutes fit app_global), `deployment/edge/adapted-build-files.test.ts` (the refusal page asks for no
file), `tests/e2e/refused-file.spec.ts` (one refused script or stylesheet leaves each page readable).
