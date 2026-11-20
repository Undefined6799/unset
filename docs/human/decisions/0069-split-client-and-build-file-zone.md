# 0069 — The web client is split into hashed pieces, and the edge counts them in their own zone

Status: Accepted by Alex, 2026-11-20 03:59Z, against 8f1fa27 (his line "Merge 1817 at 8f1fa27", typed in the project
chat after that head was reviewed; merged as d636cf2). This status paragraph, the index row and the ADR 0001 acceptance
line were added afterwards in #1827. Step P1.21g. Alex agreed to the split on 2026-11-20 00:27:59Z ("ok yes I agree, this
sounds better"), on the coordinator's summary: a small core plus per-area pieces with content-hashed names; the edge
serves only those files with their own allowance; a tab left open across a deploy reloads cleanly; the CSP stays as
strict; public profile pages still run no script; the limits on pages and data are unchanged. The edge zone loosens a
security control (ADR 0059 decision 1), so this record and its PR need his typed line. It supersedes one statement of
ADR 0031 Decision 1 and one of ADR 0066 Decision 1 (below); neither accepted record is edited.

## Context
P1.20j set `output.bundleStrategy: "single"` in `interfaces/web/vite.config.ts`: one script and one stylesheet,
because under `split` a cold app page asked for about 30 files in a second and the edge's `app_burst` (then 20 per
10 seconds) refused a third of them, so the page never hydrated. P1.20u (#1753) measured both through the staging
edge's own zones: single never saw a 429; split, with a what-if zone for `/_app/immutable/`, saved most of a returning
browser's download after a deploy (3.2 KiB against 128.1 KiB for a one-page edit) and little on a first load.

What decides it now: kit 3.2.0's `single` turns off rolldown's code splitting (`build/index.js`, `codeSplitting:
false`), which also folds every dynamic `import()` into the one file. So under `single` nothing heavy can ever load on
demand, whatever we write; a later editor such as Milkdown would ship to every page. Measured on this commit (gzip 9,
scripts/budgets/app-js.ts): single is 155 KiB of script on every app page; split is 84 to 95 KiB on the settings,
sign-in and welcome pages and 145 KiB on the owner page, whose card editor is imported statically (making it lazy is
its own step).

## Decision
1. The web client uses SvelteKit's own `split` strategy, its default. No hand-written chunking: rolldown's split under
   kit's settings, files named `/_app/immutable/{entry,nodes,chunks,assets}/<name>.<hash>.<ext>`.
2. The dev app edge gains a zone `app_files`, 120 events per 10 seconds per client address (IPv6 /64), in
   `deployment/edge/limits.json` and `snippets/ratelimit.caddy`. It counts a request only when it is a GET or HEAD and
   its decoded path before Caddy cleans it (`{http.request.uri.path}`) matches one name SvelteKit writes:
   `^/_app/immutable/(?:entry|nodes|chunks|assets)/[\w-]+(?:\.[\w-]+)?\.(?:js|css|woff2|png)$`. Such a request no
   longer counts in `app_burst`; every other request does, as before. `app_global` (1200 per 5 minutes) still counts
   every request, build files too, so a client's sustained average stays under 4 a second. `app_signin` and the PDS
   zones are unchanged.
3. Nothing else is served under that allowance. adapter-node serves the files from a table built at boot with
   `cache-control: public,max-age=31536000,immutable`; kit answers any other path under `/_app/` with a plain 404 and
   `max-age=0` before any hook runs (`respond.js:367`). The matcher is case-sensitive and anchored, so a run of
   slashes, a dot segment, a different letter case or a POST stays in `app_burst`.
4. A tab older than a deploy relies on SvelteKit's version check: when a route's import fails, the client fetches
   `/_app/version.json` and, if the build changed, loads the page in full (`client.js` `load_route`). A tab that
   already knows of a newer build (kit checks when the tab is focused or shown, and reads the version on every data
   response) loads each clicked link in full at once, through the root layout's `beforeNavigate`, as kit documents
   for `version`; it cancels the client navigation, so a superseded click cannot load its own page after the last
   one (kit's `load_route` does not check that its navigation is still current before it falls back).
5. The CSP does not change: `script-src` is already the `/_app/` path plus the startup script's hash, which covers
   every piece and its `modulepreload` link. Public, sign-in and blocked pages still run no script.
6. Superseded: in ADR 0031 Decision 1, "`app_burst`, with no matcher"; in ADR 0066 Decision 1, "the same ... lack of
   matcher". `app_burst` now matches every request except a build file.

## Alternatives
- **Keep `single`.** Smallest request count and no edge change, but nothing can ever load lazily, and every deploy
  makes every returning browser download the whole client again.
- **Raise `app_burst` until a cold split page fits** (about 100 per 10 seconds). Simpler, but it raises the allowance
  for documents and data, which reach hooks and Postgres, to cover files that never do.
- **Match the cleaned path (`path /_app/immutable/*`).** Caddy's path matcher lowercases and cleans, so `//_app/...`
  or `/_APP/...` would get the file allowance while web routes them as pages, which run hooks.
- **Leave the immutable files out of `app_global` too.** Keeps the first-visit headroom of today, but drops the one
  zone with no matcher; with build files in it an uncached first visit is about 66 requests, about 18 per address
  per 5 minutes.

## Consequences
- A cold app page is about 30 build files plus the document, its data and two fonts; the build files go to
  `app_files`, the rest to `app_burst`. Two members behind one address can open a cold page in the same second.
- After a deploy a returning browser downloads only the pieces that changed.
- A client can now request up to 120 build files in 10 seconds where it could request 60 requests of any kind;
  each is a static file read or a 404 before the hook, and `app_global` still caps the 5-minute total.
- The app page JS budget measures each page route's cold set; the owner page is above the 120 KiB warning line
  (145 KiB) until the card editor loads on demand.
- Under the local stack the app site still uses the PDS's zones (`global` 3000 per 5 minutes), where a split page
  fits as it is.

## Compliance
`deployment/edge/adapted-rules.ts` pins the three app zones, the matcher and its negation whole (reds in
`adapted-rules.test.ts`); `adapted-build-files.test.ts` holds that only the build's own names match and that no other
spelling a client can send gets the allowance where web would route it; `edge.test.ts`
`app_files_lets_two_cold_browsers_load_at_once_and_refuses_a_flood` models caddy-ratelimit's ring buffer;
`edge_ratelimit_matches_limits` pins the adapted values to `limits.json`; CI's images job checks the adapted JSON
against `caddy adapt`. `tests/integration/web/gate.test.ts`
`a_build_file_is_cached_a_year_and_a_missing_one_is_a_plain_404_before_the_hook`; `tests/e2e/redeploy.spec.ts` (its
first test fails under `single`, its second in a third to most runs without the layout's `beforeNavigate`);
`tests/e2e/csp.spec.ts` on every page.
