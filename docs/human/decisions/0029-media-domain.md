# 0029 — Media domain

Status: Proposed (awaiting Alex)

PERMANENT once media serves — a blob URL on it is referenced from pages, link previews and caches we do not
control.

## Context
ADR 0025 names four public domains (app `unset.sh`, PDS `unset.ac`, handles `unset.im`, chat `unset.cc`) and
their `staging.*` development hosts, and no media domain. PLAN.md:225 (§5.2) still reads "a throwaway domain
(for example `unsetcdn.net`; review, 2026-10-02)", and P0.11 in the step book carries that example. The media
proxy must be on its own registrable domain: not same-site with the PDS, whose device cookie is `SameSite=Lax`
and not under our control, and not same-site with the app (PLAN.md:225; P0.11, "The media domain is same-site
with the PDS or app → rejected"). Every blob a browser sees comes from it: published blobs at `/b/{did}/{cid}`
(P3.09), draft previews through short-lived signed URLs (P2.19), video assets (Phase 4), each served with the
sandbox CSP and `nosniff`, and never a raw PDS `getBlob` to a browser.

The staging pre-flight dry run of 2026-10-19 (main 58ee470, finding A9) set `staging.unset.site` as the media
origin and web refused it: `KNOWN_TLDS` (`shared/http/config.ts:15`) lists `.sh`, `.ac`, `.me`, `.space`, `.net`
and `.test`, so `siteOf` cannot place a `.site` host and the `MEDIA_ORIGIN` rule fails closed, as designed (a TLD
the list does not know is refused rather than guessed). Nothing can serve on a media domain until one is decided.

Architecture ruled at 2026-10-19 20:01Z (real UTC; the staging rulings record, "Media origin (A9)"): the domain is
Alex's to decide through a Proposed ADR, and recommended `unset.site`, a separate registrable domain Alex already
holds, with `staging.unset.site` on staging.

## Decision
The media domain is `unset.site`. The development media host is `staging.unset.site`, a subdomain of it, not a
separate registration, following ADR 0025's pattern for the other four roles.

| Role | Domain | Development host |
| --- | --- | --- |
| Media | `unset.site` | `staging.unset.site` |

- `unset.site` is a different site from `unset.sh`, `unset.ac`, `unset.im` and `unset.cc`, and
  `staging.unset.site` is a different site from every ADR 0025 staging host, so the media origin is cross-site
  with the app and the PDS in both environments, as §5.2 requires. `staging.unset.site` and `unset.site` are
  same site with each other, which is harmless: media sets no cookie of ours.
- The media proxy sets no cookies and ignores any it receives (P2.19). Under staging no Pangolin login sits on
  the media host (below), so no Pangolin cookie is set on it either.
- `KNOWN_TLDS` gains `.site`. That widens an allowlist in a trusted-base file, so it is its own PR, after this
  record is accepted, on Alex's typed line:
  "yes shared/http/config.ts KNOWN_TLDS add .site for the media domain unset.site". The `.net` entry, there for the
  placeholder example, is that step's to keep or drop; this record does not decide it.
- Staging: `staging.unset.site` is published through the same Pangolin instance as `staging.unset.sh` and
  `staging.unset.ac`, as a resource with every authentication method off, for this host only (architecture,
  2026-10-19 20:17Z real UTC). The login cannot protect it: Pangolin's resource session cookie is always
  `SameSite=Lax` (`server/auth/sessions/resource.ts:178-197` at 1.24.0), and a browser never sends a Lax cookie
  on a cross-site subresource request, so an image on `staging.unset.sh` loaded from `staging.unset.site`
  would get the login redirect instead of bytes. In plain words: the media address skips the staging password,
  because browsers will not send that password's cookie to a different domain when a page loads an image.
  Until the real safety scan is live (P5.07b) and the rescan has run, the media address serves only five-minute
  signed previews: a tester's own drafts, and from P4.12 a moderator's review thumbnails; after that, anyone
  with the exact link could fetch a published picture from a test account, the same as it will be after launch.
  What still holds on that host is what holds in production: P3.09 serves a blob only when an indexed record of
  a visible account references it, drafts need P2.19's short-lived HMAC-signed URLs, every response media sends
  carries the sandbox CSP and `nosniff` with no cookie of ours (a path dropped at Pangolin gets Pangolin's own
  denial, `server/routers/badger/verifySession.ts:316-331`, which carries no media bytes and no cookie of ours,
  so that invariant is not weakened by it; architecture, 2026-10-19 21:17Z real UTC), takedown reaches the
  bytes, media's own limits apply (300 requests a minute per address and 3000 overall,
  `interfaces/media/limits.ts`, applied by `rateLimitIp` at `shared/http/server.ts:85`), invites gate uploads,
  and the login on the app and PDS hosts with their exact-match bypasses is unchanged. One limit is weaker on
  staging than the numbers suggest: the dev edge withholds the client address from every upstream
  (`deployment/edge/snippets/upstream.caddy:14-18`, P1b-A1),
  so media keys all requests on the edge's own address. Until the edge's media zone lands, all staging media
  requests share one limit of 300 a minute, so anyone with the address can slow previews for every tester. The
  staging media site therefore gets its own edge rate-limit zone keyed on the client address under P1.36j's
  Newt-only trust (red: two client addresses behind Newt get separate media quotas), on the go-live list
  before media opens; P1.36j itself books no media site, so the zone rides the dev edge media site item below,
  on that item's trusted-base line; production keeps P5.02's design (architecture, 2026-10-19 21:10Z and
  21:25Z real UTC). The media resource carries Pangolin path DROP rules for everything outside
  the media routes the step book names, today `/o/*` (P2.19), `/b/*` (P3.09), `/v/*` (P4.16) and `/x/*` (P4.21a,
  phase-4.md:2975). A route joins the allow list only once its own serving rules are in place and tested; for
  `/x/*` that means its net-guard egress, its rate limits and an equivalent of the scan condition below for
  proxied content that never passed our upload gate, and until then `/x/*` stays dropped on staging
  (architecture, 2026-10-19 20:44Z real UTC). Until P5.07b's real scan lands, the resource allows only `/o/*`,
  signed 5-minute URLs minted only for the uploader, and from P4.12 for a signed-in moderator; never a public
  URL, so not public use; `/b/*`, `/v/*` and `/x/*` stay dropped, because on staging the scan is P2.16's fake,
  which always clears, and L.03a and decision 23 (PLAN.md:655) accepted the fake only because the real scan
  comes before any public use. Each of the three opens only when P5.07b is live, after an L.03a-style rescan has
  run every staging object through the real checker (a blob it does not clear stays 404 and goes to the CSAM
  preservation path if it matches), and per the 20:44Z addendum; a scan record names the checker that wrote it
  and P3.09a serves a published blob only on a passing record from the real checker, so a record the fake wrote
  never counts, wherever it is read (red: a blob with a passing record from the fake checker gets 404, even
  after P5.07b is live). L.03a as booked writes only the aggregate `retro_scan_record` (launch-gate.md:313-353),
  so on `clear` the staging rescan and L.03a both write the per-object passing record P3.09a reads, keyed (did,
  cid) and naming the real checker, beside the aggregate record, and a blob not cleared gets no record; the step
  book places that requirement in L.03a or P3.09a (red: a previously fake-cleared blob is 404 before the rescan
  and served after it; architecture, 2026-10-19 21:18Z). The cost is that staging shows no published images on
  profile or editor pages until then, only five-minute signed previews: a tester's own drafts, and from P4.12 a
  moderator's review thumbnails (architecture, 2026-10-19 20:58Z and 21:10Z real UTC, tightening 20:17Z and
  20:38Z; decision 23 stands). The rules are path-only, because 1.24.0 cannot combine a path with a method, and
  it cannot negate a path match either, so the shape is one PASS
  rule per allowed prefix at a higher priority, then DROP `/*` last, and never ACCEPT, which would be the
  wildcard bypass ADR 0025 refused; DROPs narrow access, so that refusal is not touched; the media server
  itself refuses every method but GET and HEAD. One condition holds before that resource is created, and one
  before `/b/*` opens. First, Pangolin's request audit log must be off for the staging org (its request-log
  retention set to 0, the only setting at which 1.24.0 buffers no request URL,
  `server/routers/badger/logRequestAudit.ts:216-221`; then, after at least 300 seconds, since the setting is
  cached that long, `:158-163`, and rows written under the cached value would survive an earlier purge, the rows
  already stored for the org purged (without the purge they stay until cleanup); and only then the deploy
  check. The wait is at least six minutes in practice, the 300-second cache plus the 5-second write batch,
  `:56`, since a row buffered just before the cache expires reaches the table up to 5 seconds later) and its
  proxy access log must not record query strings, because the audit log otherwise persists the full URL of
  every request, a signed draft preview URL's `sig` included; the Pangolin amendment ADR states the setting,
  since it is org-wide and covers the app resource's `/oauth/callback` code too (architecture, 2026-10-19
  20:47Z real UTC). Second, fail closed and with zero
  tolerance for CSAM: media must not serve a blob that has not passed the same safety scan as the upload gate.
  P3.09 as booked does not refuse a blob without a passing scan record, so P3.09a (#1122, [SEC]) adds that
  refusal (red: a blob referenced by a visible record but never scanned gets 404). P3.09a is the precondition
  for opening `/b/*` on staging, not for creating the `/o/*`-only resource, which needs only P2.19, the dev edge
  media site item below (P1.38c, #1126) and the retention setting above (architecture, 2026-10-19 20:38Z, 21:10Z
  and 21:25Z real UTC; readiness row 10k). P3.09a's rule covers blobs uploaded through our gate, which today
  means accounts on our own PDS; a blob of an account on another PDS is served only after a scan on fetch, the
  same as P4.21a, and until that follow-up (P3.09b, #1123, [SEC], before sign-in opens to other PDSes) exists it
  gets 404, with no exception (architecture, 20:58Z).
  The TLS hops are the app name's two (Pangolin's HTTP-01 certificate in front, the edge's DNS-01 certificate
  behind Newt). Public DNS holds for it the same shape as for `staging.unset.sh`: A/AAAA to the
  Pangolin host, the `_acme-challenge` CNAME into the validation zone, and four CAA records
  (`CAA 0 issue "letsencrypt.org; validationmethods=dns-01"`,
  `CAA 0 issue "letsencrypt.org; validationmethods=http-01"`, `CAA 0 issuewild ";"`,
  `CAA 0 iodef "mailto:security@unset.sh"`). The apex `unset.site` stays parked (P0.11's parked set) until
  Phase 5 serves it.
- Production: `unset.site` is served by our own edge in Phase 5 (P5.02). Its ACME challenge is Phase 5's to
  choose; if it is DNS-01, it uses the delegated-zone pattern ADR 0025 gives `*.unset.im`, with its own typed
  line.
- P0.11's checklist (registrar lock, DNSSEC with the DS submitted, auto-renew, WHOIS privacy) applies to
  `unset.site` as to every domain of ours, and `docs/human/domains.md` gets its row.

## Alternatives
- A throwaway `.net` registration such as `unsetcdn.net`, as PLAN.md:225 suggests. Rejected: it is one more
  domain to buy, lock, sign and renew for no isolation `unset.site` does not already give, and Alex already
  holds `unset.site`.
- A subdomain of the app, such as `media.unset.sh`. Rejected: a same-site host weakens the SameSite protection
  on the app's sessions, as it would on the PDS's `SameSite=Lax` device cookie under `unset.ac` (PLAN.md:747, the
  reason the PDS is not on an app subdomain either); §5.2 requires a separate registrable domain, and P0.11
  rejects this case by name.
- A subdomain of the handle domain, such as `media.unset.im`. Rejected: the handle domain is for user-named
  hosts, and no user may claim an infrastructure host name there (PLAN.md:227-230); its wildcard certificate's
  DNS credential "cannot touch the app zone or `_lexicon`" (PLAN.md:230), and media would sit in the zone that
  credential serves; ADR 0025:89-94 keeps `*.staging.unset.im` internal with
  no Pangolin wildcard, so staging media could not be published; and `KNOWN_TLDS` would need `.im` anyway.
- Serve blobs from the app origin with the sandbox CSP alone. Rejected: the CSP sandbox limits what a served
  document can do, not what a request to that origin carries; cookies and origin-scoped browser state still
  reach it (the atproto production guidance PLAN.md:747 records).
- A separate media domain for staging. Rejected: development is a label under the public domains (ADR 0025).
- Keep the Pangolin login on the staging media host and add path rules that bypass it for the blob routes
  (`/o/*`, `/b/*`, `/v/*` and `/x/*`). Rejected: Pangolin's path rules match by wildcard, and ADR 0025 refused
  wildcard bypasses.
- Keep the login with no bypass and accept that staging shows no images until the public opening (P1.33p).
  Rejected: the media gates (P2.19 now, P3.09 once P5.07b is live) would be unprovable on staging, which is
  what staging is for.

## Consequences
- PLAN.md:225, P0.11's "example `unsetcdn.net`" and the candidates in `docs/human/domains-checklist.md:14-17`
  (`unsetcdn.net`, `unsetmedia.net`, `unset-cdn.net`) are superseded by this record on acceptance; the plan text
  catches up in its next maintenance PR, P0.11's registration list drops the throwaway, and the checklist names
  `unset.site`, all in one product PR the step book letters on acceptance. The public domains page
  (`apps/web/legal/domains.en.md:11-13`, which still says the media name is not chosen and that development uses
  four domains) is corrected in that same PR to name `unset.site` and say staging uses five domains, since it is
  the anti-phishing guidance users read (architecture, 21:17Z).
- Web refuses to start with `https://staging.unset.site` as its media origin until the `KNOWN_TLDS` PR lands
  (the refusal is web's config load, not the preflight, which checks only that the origin is https). That PR
  joins the staging go-live list (A9) when the step book letters it, after acceptance.
- Alex's staging list gains: DNS for `staging.unset.site` as above, a Pangolin resource for it with every
  authentication method off and the path rules (PASS `/o/*`, then DROP `/*`, until P5.07b), the org's
  request-log retention set to 0, then after at least six minutes (the 300-second cache plus the 5-second write
  batch) its stored rows purged, the access-log format without query strings, and its CAA set.
- Our side: under dev the edge needs a site for `staging.unset.site`, which is P2.19's edge route for the media
  domain plus the P1.36e DNS-01 override for that name and the media rate-limit zone keyed on the client
  address under P1.36j's trust (architecture, 21:25Z). That is a trusted-base edge change with its own typed
  line, lettered P1.38c (#1126).
- A real staging deploy must prove, on the media host: a signed `/o/*` draft preview loads within its 5
  minutes, and `/b/*`, `/v/*` and `/x/*` are dropped at Pangolin (until P5.07b and the rescan; after them,
  images load on the editor and profile pages, a blob no visible record references is refused, and a blob whose
  only passing record came from the fake checker is refused); two client addresses behind Newt get separate
  media quotas once the edge's media zone is in; a draft preview URL without
  its signature is refused; a dropped path (today `/b/*`, and any app or PDS path) on `staging.unset.site` gets
  Pangolin's denial and not a media response, an unknown path under a passed prefix gets media's 404 with its
  headers, and `staging.unset.sh` and `staging.unset.ac` still demand the login; after one draft preview and one
  sign-in, Pangolin's request audit table holds no rows for the staging org and its access log shows no `sig=`,
  `code=` or `state=` (architecture 20:17Z, 20:38Z, 20:47Z, 20:58Z, 21:10Z, 21:17Z and 21:25Z; a staging
  section-3 check).
- The staging media host is reachable from the internet without the staging login. Until P5.07b and the
  rescan, only signed `/o/*` previews are served; after them, published pictures of test accounts are fetchable
  by anyone holding the exact DID and CID, and the media routes can be probed, which is the production posture;
  no production data or account ever touches staging (ADR 0025). The app and PDS
  hosts keep their login. A tester can put a file straight into their repository, skipping our upload checks,
  and without the scan condition above, once a visible record references it anyone with the link could fetch
  it. A blob without a passing scan record gets 404. A file written straight to a repository never passes our
  upload route, so it stays 404. On staging the answers are the invite list
  and a takedown on our PDS, a browser may keep a copy for up to 600 seconds, and abuse could put
  `unset.site`, production's media domain, on blocklists.
- The media origin appears in Certificate Transparency logs and in this record; it reveals nothing new.
- The page CSPs (`img-src` from P2.19, `media-src` from P4.16, admin's from P4.12) and the public zero-JS pages
  take the origin from `MEDIA_ORIGIN`, unchanged; no code names the domain.
- `KNOWN_TLDS` also lacks `.im` and `.cc`. The step book checked at 20:05Z: `siteOf`'s only caller is the
  `MEDIA_ORIGIN` rule (`shared/http/config.ts:77-78`), no handle or chat host goes through it, and the Origin
  gate compares exact origins, so no step is lettered for them. A later same-site check on such a host would
  need the same kind of typed line then.

## Compliance
`shared/http/config.test.ts` pins that a TLD outside `KNOWN_TLDS` is refused and that the media origin must be
another site than the public origin; the `KNOWN_TLDS` PR adds a case that `https://staging.unset.site` is
accepted beside `https://staging.unset.sh` and `https://unset.site` beside `https://unset.sh`, and that
`https://media.unset.sh` is still refused. `shared/http/` is a trusted-base path, so that PR routes to Alex and
rides on his typed line above. Acceptance of this record is his line
"yes accept ADR 0029 media domain docs/human/decisions/0029-media-domain.md"; ADR 0001 gains its one-paragraph
entry then, as ADR 0025 did.
