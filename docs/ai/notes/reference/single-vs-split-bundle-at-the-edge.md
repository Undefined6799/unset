---
id: single-vs-split-bundle-at-the-edge
type: reference
status: current
areas: ["[[web]]", "[[deployment]]"]
summary: "Measured P1.20u: split breaks every cold page under today's app zones; with a hashed-file zone it saves redeploys."
code: [interfaces/web/vite.config.ts, deployment/edge/snippets/ratelimit.caddy, tests/e2e/bundle-measure]
sources: [https://svelte.dev/docs/kit/configuration#output, https://github.com/mholt/caddy-ratelimit/tree/5625512f24f6]
importance: high
related: ["[[web]]", "[[deployment]]"]
replaced_by: null
tags: [reference, web, deployment]
checked: 2026-11-19
---
# Single versus split client bundle, measured through the app edge (P1.20u)

Main 0555ff7 built twice (kit 3.2.0 `output.bundleStrategy` `single` and `split`, nothing else changed), served by
the built web in socket mode, behind Caddy 2.11.9 with caddy-ratelimit 5625512f24f6 running staging's own
`app-ratelimit` snippet (app_burst 20 per 10 s, app_global 1200 per 5 min) from one client address, in Chromium
(Playwright 1.64.1). Staging was not touched. How to rerun:
[tests/e2e/bundle-measure/run.ts](../../../../tests/e2e/bundle-measure/run.ts).
Two full runs gave the same counts and bytes; times moved by under 0.1 s. Bytes are as sent (brotli for JS and CSS),
KiB = 1024 bytes. The member is signed in; the pages are the owner page, Settings › Profile, Settings › Account.

**Requests and 429s with today's zones.**
- Single: a cold page is 6 requests (HTML, one script, one stylesheet, two fonts, the favicon), peak 6 per 10 s,
  no 429. A warm page is 1. Two cold tabs at once: 7. A visit (owner page, two settings pages by link, back twice):
  10. Nothing ever refused.
- Split: a cold page is 30 to 32 requests in about a second, so the peak per 10 s is the whole load. The edge refused
  12 of 32 (owner, profile) and 10 of 30 (account): script chunks, both fonts, the favicon. The page never hydrated.
  A reload or a new tab within the window was refused as a whole (the HTML itself got 429). Two cold tabs: 46
  requests, 26 refused. A returning browser after a deploy that touched a shared component: the HTML of Settings ›
  Account refused. Split cannot ship under today's zones.

**What split buys, read with a what-if zone.**
[edge-asset-zone.caddy](../../../../tests/e2e/bundle-measure/edge-asset-zone.caddy) (local only, never a proposal as written) counts `/_app/immutable/` in its own zone and leaves documents and fonts in
today's zones. With it no request was refused in either mode, and:
- JS per cold page, single: 128.1 KiB on every page. Split: owner 128.9, profile 83.4, account 78.5. CSS is one
  8.9 KiB file in both. The owner page gains nothing: the card editor is imported statically, so its code ships with
  that route either way (no lazy chunk exists to measure; opening it fetched 0 bytes in both, 0.55 to 0.62 s on the
  slow profile).
- A whole visit, cold: single 128.1 KiB JS in 10 requests; split 133.4 KiB in 39.
- Hydration on Lighthouse's mobile profile (150 ms RTT, 1.6 Mbps, CPU 4x), cold: single 1.74 to 1.85 s on all three;
  split 1.78 s owner, 1.58 to 1.67 s on the settings pages. Unthrottled both are 0.1 to 0.25 s.
- After a deploy, a browser that had the three pages cached downloads again: single 128.1 KiB (the one bundle) for any
  edit. Split: 3.2 KiB for an edit to one page (that route's node and the app entry), 72.4 KiB for an edit to the
  shared Button (its hash ripples through 17 files). This is the real gain.
- Peak hashed files per 10 s from one address: 29 for one cold page, 32 for a cold visit, 31 for two cold tabs.
  Documents, fonts and data stayed under 10 per 10 s, far inside app_burst.

**Recommendation.** Keep `single` today: nothing on main changes. Split is worth switching to for redeploys, not for
first loads, and only together with an edge zone for hashed files, which loosens a security control and needs Alex's
typed line. The numbers above size it: about 100 per 10 s per address covers three cold tabs at once with room; the
files are static, hashed and served by adapter-node before any hook or database work. That next PR also has to
rewrite `scripts/budgets/app-js.ts` (it sums every file under `_app/immutable`, which under split is the whole app,
not a page) and recount the cold-page figures in the ratelimit.caddy comment. To make the owner page itself smaller,
the card editor would need a dynamic import; that is its own step.

**Seen on the way.** The HTML went out uncompressed (no `Content-Encoding`, 58 to 61 KiB, though the browser offered
br): neither the app site nor web compresses documents. Not part of this step; worth its own look.
