# 0035 — Web search through our own SearXNG, queried by the server

Status: Proposed (awaiting Alex in the P3.14s pull request)

## Context
On 2026-10-21 22:05:56Z Alex decided that the app's search bar also searches the web: "also the search bar will do
searxng research" (the switch and button styling thread, where the bar is being designed). The bar lists matches on
unset.sh first (P3.14's directory search), then a few web results, then a line that runs the full web search.

SearXNG is a self-hostable metasearch engine (AGPL-3.0): it forwards one query to several upstream engines and merges
their answers, and it keeps no account and no history of its own. Letting it answer our search bar adds an external
system to the stack, and the way its queries leave our network is a privacy boundary that is expensive to change
later: a visitor's search terms are the most sensitive thing they type into the app after their password, and SE-7
forbids them in any log. The plan already has one way out of the stack for caller-influenced requests, net-guard
(plan §2 rule 13; ADR 0022 for `web`). That makes this a decision for a record (D8).

## Decision
1. **Our own instance, nothing public.** One `searxng` service in the compose stack (`compose.dev.yaml`,
   `compose.local.yaml`; prod at P5.02), from a digest-pinned vendor image under the seven-day age rule, non-root,
   read-only root, `cap_drop: ALL`, `no-new-privileges`, limits. It publishes no port and carries no edge site: no
   browser, ours or anyone's, ever reaches it. It joins two networks only: `search` (internal; members `web`,
   `searxng`) and `search_egress` (not internal; member `searxng`), both rows in `deployment/networks.dev.json`. We
   never query a public SearXNG instance or a search API vendor: whoever runs the engine sees every query.
2. **The server asks, through net-guard.** `web` calls the instance from an `infrastructure/search` adapter, with a
   net-guard `internal` policy naming the one origin `http://searxng:8080` (plan §2 rule 13: no bare `fetch`; the
   egress guard covers the folder). Requests are `GET /search?format=json`, no redirects, a time cap of 3 s and a
   body cap of 256 KiB; the adapter returns at most ten `{title, url, snippet}` rows, each a string, every `url`
   `https:` or `http:` and nothing else, or one `search.*` code. The browser talks only to `web`.
3. **A query is content, never a field (SE-7).** `web` logs the request with its typed fields only (route template,
   status, ms, `code`); the query string, the result urls and the upstream engine names never enter a log, an audit
   lane, a metric label or an error message. The instance's image proxy is off, and it receives no forwarded client
   address (`web` sends no `X-Forwarded-For`, `Forwarded` or `X-Real-IP` header). SearXNG documents no switch for
   its request log or a result cache (docs.searxng.org, 2026-10-21), so P3.14s makes the builder find the real
   mechanism in the pinned image or record that the property does not hold; our own side holds either way. Upstream engines see our instance's egress address and nothing about the visitor. The results
   page sends `Referrer-Policy: no-referrer` and every result link carries `rel="noopener noreferrer"`, so the query
   and our page do not travel with a click. No search history is stored for anyone, signed in or not.
4. **Our limits, not the engine's.** The route uses `interfaces/http/limits.ts`'s `search` policy (60 per minute per
   address and per DID, P1.06p) plus one new `web_search` entry with a global scope, so one stack cannot be used to
   hammer the upstream engines from our address; SearXNG's own limiter stays off, since it keys on client addresses
   it never sees. The page is signed-in only, like `/people` (P3.14).
5. **The engine can fail without the app failing.** A timeout, a refusal, a malformed body or an open circuit (five
   failures in a row open it for 30 s) returns `search.unavailable`; the page still renders the directory matches
   with one line saying web search is unavailable, status 200. Nothing retries inside a request. The instance's
   health is a preflight check and a runbook line, not a boot requirement of `web`.
6. **Results are third-party text.** `web` renders the three strings, escaped, with `safeHref` on the url; it renders
   no HTML, image, favicon or thumbnail from the engine, and stores nothing. The engine list lives in a committed
   `deployment/searxng/settings.yml`; the instance's `secret_key` is the only secret, in `searxng.env` beside
   `pds.env`, with an exact-name-set preflight check like C30.

## Alternatives
- **A commercial search API (Brave, Bing, Google Programmable Search).** One HTTPS call and better ranking, but every
  query goes to the vendor under its terms, with a key to hold and a bill that scales with use. Rejected: the vendor
  would hold a log of what our visitors search for, which is the thing this record protects.
- **A public SearXNG instance.** No service to run. Rejected: a stranger's server sees every query, and its
  availability, engines and logging are not ours to set.
- **Search from the browser.** The visitor's browser would call the engine directly. Rejected: the visitor's address
  and user agent reach the engine, our page cannot vouch for what comes back, and it breaks the rule that pages make
  no third-party request.
- **Directory search only.** No new system. Rejected by Alex's line.

## Consequences
- One more service to pin, patch and watch: the image joins `bases.lock.json` and the mirror list (P2.26b), and its
  settings file is reviewed like compose. Upstream engines may throttle or block our egress address; the app then
  shows "web search unavailable" until the engine list or the address changes, and nothing else degrades.
- Result quality and ranking are the engines'; we store, rank and cache nothing in v1, so a query costs one upstream
  round each time. Caching is a later step with its own privacy argument.
- The query never leaves `web` except toward the instance, so the request log cannot answer "who searched for
  what"; incident work correlates by `reqId` only (SE-7).
- SearXNG is AGPL-3.0, run unmodified as a separate service, so our licence (ADR 0012) is unchanged.
- `web` gains a second egress path beside `web_egress`, but through an internal network to one origin; net-guard's
  `internal` kind refuses any public answer, so a renamed or spoofed `searxng` name cannot redirect the query out.

## Compliance
The P3.14s tests hold this record: `searxng_only_on_search_networks` and `searxng_publishes_nothing` (compose),
`search_query_never_logged` (the canary query is absent from logs, audit tables and metrics), `search_results_text_only`
(no markup, no non-http scheme), `search_engine_down_page_still_renders`, `search_rate_limited`, and net-guard's
policy tests for the `internal` origin. The egress CI guard fails any call to the instance outside net-guard.
Acceptance is Alex's line on the pull request that adds this record; ADR 0001 notes the proposal at its end and
gains the acceptance paragraph when he accepts. The status line stays Proposed until then. Reviewed at P5.02, when
the prod network table is built.
