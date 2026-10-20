# 0031 — Staging public through Pangolin, no login, no certificate at our edge

Status: Proposed (awaiting Alex)

## Context
Accepted ADR 0025 (2026-10-19 04:17:55Z) puts `staging.unset.ac` behind Alex's Pangolin with the same tester login
as `staging.unset.sh` and "no bypass at all" (0025:84-88), and has the edge hold its own Let's Encrypt
certificates for both staging names by DNS-01 through a delegated validation zone (0025:65-71), which preflight C18
(`deployment/preflight/checks/edge.ts:395`) enforces as the only issuer. Accepted ADR 0030 (2026-10-19 23:17:16Z)
restates that `staging.unset.ac` has no bypass (0030, Decision 1).

The validation zone needs either a purchased challenge domain or a Cloudflare token on the product zones (ADR 0028,
not yet written). On 2026-10-19 Alex declined both for staging and settled the shape in the project chat: "Lets not
use certificate internally for now but we will set it up for production deployment" (23:19:26Z), "Its ok they will
both have a lets encrypt certificate" (23:20:10Z), "Pangolin will issue them certificate" (23:20:21Z), "Its ok the
pds will be facing out as well" (23:20:39Z), "Pds is meant to be queried publicly" (23:20:49Z).

On 2026-10-20 at 13:00:31Z, asked for the simplest deploy, Alex dropped the login on the app name as well: "Go
ahead for ADR 31, and also I'll take time to add to say that no need for a Pangolin login for staging right now.
So no password needed right now for to access the app. Like the invite only is gonna be like the gate for the
staging. And then we can figure something out later once we become more popular." The tester gate is therefore
the PDS invite code (`PDS_INVITE_REQUIRED`), not a Pangolin login, on both names.

Why that removes the certificate question: Pangolin terminates public TLS for both names with its own Let's Encrypt
certificates and does not verify the edge's certificate (0030, Context). The one client inside the stack that did
verify the edge's certificate was web reaching the PDS through the edge's PDS alias (0025:86). With the PDS public,
web can reach it by its public name through Pangolin, verifying Pangolin's certificate with the normal trust store,
exactly as the PDS already fetches the app's client metadata (0025:81-83). Nothing in the stack then verifies the
edge's certificate, so under dev the edge needs none. Architecture ruled this shape at 23:22Z
(`unset-plan/book-edits/2026-10-19-staging-tailnet-rulings.md`).

## Decision
This record departs from ADR 0025 at three clauses, for the dev profile only: the two above, and 0025:74-78
(`staging.unset.sh` behind the login with two bypass paths) together with 0025:49-51 (one SSO login per tester).
It departs from ADR 0030 at four points: 0030's "`staging.unset.ac` has no bypass" and the whole of Decision 1
(the two ACCEPT rules, their probes and the live-resource rule check, which now has no login to demand), 0030
Decision 3 (the resource session cookie, which a public resource never sets), 0030:78-79 ("The edge keeps its own
Let's Encrypt DNS-01 certificate for the staging names"), and the alternative 0030:130-132 rejected, plain HTTP
from the edge to Newt, which this record adopts. 0030 Decision 2 (host conditions) and Decision 4 (logging) stand
unchanged. Neither record is edited; both keep their status. Production is unchanged: `unset.ac` stays behind
whatever ADR 0028 and the Phase 5 records decide, with Let's Encrypt at the edge, and a login or other gate on a
production name is a Phase 5 decision.

1. **Pangolin.** Both `staging.unset.sh` and `staging.unset.ac` are public resources at Pangolin: no login, no
   rules, no bypass paths to carve out. Pangolin's targets to Newt are plain `http`; Pangolin does not verify the
   edge in any case (0030). What the login on `staging.unset.sh` was protecting: the app's unreleased surface and
   its unauthenticated routes (the welcome page, sign-in start and callback, static assets) from the open internet,
   a second, per-tester identity in front of the app's own session, and scanner noise before the live checks had
   run. What holds without it: nobody gets an account without an invite code, and the app refuses sign-in for any
   account not on our PDS (P1.36v, #1131, never waived), so a stranger can read the public pages and nothing more;
   the app's own verified session, Origin gate and `__Host-` cookies are the authorization, as 0030:84 already
   said; the edge's per-visitor zones of Decision 3 cover the app routes too (`session`, `oauth_signin`, `global`),
   so Decision 3's key change is a precondition of opening either name; the security headers, CSP and audit log
   (DID and address only) stay; Pangolin's own protections (its CrowdSec bouncer and 0030 Decision 4 logging)
   apply to both names; and no media is served. Tester profile pages are public by design (ADR 0004). What is
   lost and accepted: the per-tester Pangolin identity, which gave a second credential and a name in Pangolin's
   log; the app's audit log keeps the DID. Alex revisits a gate "once we become more popular"; until then any
   gate on a staging name is a new Proposed record.
2. **Edge without a certificate under dev.** Under dev the edge's two sites listen on plain `http`, bound only to
   the edge's address on the internal `newt_edge` network (0030, Decision 2), with no published port and no `:443`
   site. Preflight C18 under dev will check exactly that shape, a future change to C18 that needs Alex's own typed
   line, and under prod C18 keeps refusing anything but Let's Encrypt; a plain-`http` site under prod is a preflight
   failure. The app and the PDS never derive their scheme from the
   request: cookies stay `Secure`, and the OAuth issuer, the client metadata URLs and every public URL stay `https`
   from configuration. Both sites still send the security headers. Reds, each in `deployment/edge` or preflight
   tests: the bind address and the absent port; no `:443` site under dev; prod refuses plain `http`; scheme never
   taken from the request (app and PDS configuration); headers present on both sites. The `_acme-challenge`
   CNAMEs of 0025:65-71 are not created for staging, and the CAA records on both staging names drop the edge's
   `dns-01` issuer line (a tightening); Pangolin's `http-01` line stays as 0025 lists it. ADR 0028 and the
   validation-domain ruling of 21:52Z apply to production, where `*.unset.im` still needs DNS-01; that question
   returns before Phase 5. P1.36e, P1.36o and the DNS provider steps move to production. ADR 0029's dev media
   site `staging.unset.site` (0029:117-122, P1.38c) depended on P1.36e's certificate; that site is out of this
   milestone (Alex, 2026-10-19: pictures and media deferred at 21:50Z, and his 21:49Z tap "Four domains only" on
   the card "Keep unset.site as a fifth domain, only for pictures?" drops `unset.site`), and 0029 is being
   rewritten for the four domains. Any dev media site that returns takes this
   record's plain-`http` shape behind Pangolin or comes back to architecture for a ruling; no dev certificate work
   is kept for it.
3. **In-stack hop through Pangolin.** Under dev the compose file drops the PDS-host alias on the edge, symmetrical
   with the app-host alias it already drops (0025:81-83), so web resolves `staging.unset.ac` through public DNS to
   Pangolin and reaches the PDS through Pangolin, Newt and the edge. net-guard loses its one internal-host
   exception (`infrastructure/net-guard/src/policies.ts:11`) on staging, a tightening: every host web fetches must
   resolve to public unicast addresses. No `NODE_EXTRA_CA_CERTS` anywhere on staging (a red: no staging service
   names a dev root). Rate limits: web gets no IP allowlist and no Pangolin bypass. Today every edge zone keys on
   `{remote_host}` (`deployment/edge/snippets/ratelimit.caddy:19-127`) and the Caddyfile names no trusted proxy
   (`deployment/edge/Caddyfile:36`), so behind Newt every client would share one bucket and one stranger could
   block every tester's sign-in on the public PDS. Under dev the keys move to `client_ip`, as 0025:195-204 requires,
   with Newt as the only trusted proxy; P1.37v's scope gains a red that pins the dev zones to the client address
   and the trusted proxy to exactly Newt. The `staging.unset.ac` zones are sized from web's measured peak plus
   headroom. Alex's
   own browser shares a bucket with web, since both arrive from his egress address, so a `429` for him is a known
   cost. A CrowdSec or rate-limit allowlist for his egress address would be a loosening that needs his own typed
   line; until then the limits fail closed.
4. **What `staging.unset.ac` exposes, and what the edge denies.** The policy is a denylist, not an allowlist:
   everything the PDS serves is public except the denies below. That means every XRPC method of the pinned PDS
   image (for example `com.atproto.server.*`, `repo.*`, `sync.*` including `subscribeRepos`, `listRepos` and
   `getRepo`, `identity.*`), the OAuth endpoints (`/oauth/authorize`, PAR, token,
   `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) and the PDS account pages;
   the build step lists the routes from the PDS source at the pinned version, not from memory. The edge denies
   on `staging.unset.ac`: (i) the admin surface, already in `deployment/edge/snippets/xrpc-guard.caddy:8-25` and
   kept on the public name: `404` for `/xrpc/com.atproto.admin.*`, `com.atproto.temp.*`, `tools.ozone.*`,
   `com.atproto.server.createInviteCode` and `createInviteCodes` in any letter case; `401` for any XRPC request
   carrying `Authorization: Basic`, since admin authentication is Basic and some admin-authenticated methods sit
   outside `com.atproto.admin`; `400` for a malformed XRPC path (encoded characters, extra segments, trailing
   slash, case games with `xrpc`), matched on the raw request target; the runbook runs admin calls from the
   staging host against the PDS container, never the public name; (ii) until P5.07b's
   real scan exists, `com.atproto.repo.uploadBlob`, `com.atproto.sync.getBlob` and `com.atproto.repo.importRepo`,
   because a public `getBlob` would make an unscanned public image host, which the 20:58Z ruling, our zero tolerance
   for CSAM and the vault note `research/atproto-blob-serving-security` forbid. No media is in this milestone, so
   nothing breaks; a blob path that opens later carries the sandbox CSP and `nosniff`. Each deny gets a property-test
   red (TE-6) covering case, percent-encoding, trailing-slash and doubled-slash variants, in the shape of 0030's
   probe groups. Still holding: `PDS_INVITE_REQUIRED` (open sign-up waits on P5.02a), the admin password usable
   only from the host, the edge's rate-limit zones, own-PDS-only sign-in (P1.36v, never waived), and no media in
   the milestone; the app itself is public under Decision 1 and gated by its own session. The PDS's own rate
   limits are not a layer: they stay off
   (`PDS_RATE_LIMITS_ENABLED=false`, `deployment/compose.dev.yaml:114`, required exactly so by preflight C7) because
   the edge strips the forwarded-address headers on the PDS route and the PDS would see one address for everyone,
   so turning them on would make one bucket that anyone could exhaust. On the public PDS, `createSession`, the
   OAuth sign-in and token endpoints and password reset are limited only by the edge's zones
   (`deployment/edge/snippets/ratelimit.caddy`: `session`, `session_day`, `oauth_signin`, `oauth_token`, `signup`,
   `reset`, `sync`, and the `global` zone, which has no matcher so every PDS route has a zone, `:126-131`), keyed
   per client once Decision 3's key change lands; the existing red `edge_ratelimit_matches_limits` keeps the zones
   equal to `limits.json`. Architecture ruled this at 23:33Z, correcting its 23:22Z "PDS and edge rate limits".
5. **Federation and what testers are told.** `PDS_CRAWLERS` stays empty, so the PDS itself requests no crawl, but
   anyone can send `requestCrawl` for `staging.unset.ac` to a public relay, and a relay that finds the PDS may
   subscribe to its firehose; the public `com.atproto.sync.listRepos` lists every tester's DID; a tester's DID,
   handle history and PDS endpoint stay in `plc.directory`'s log for good, and neither deactivation nor deletion
   removes them or copies third parties already hold. Tester repos are public atproto data (ADR 0004). No
   mitigation; the tester notice says all of this before an invite is used. The runbook says how tester accounts
   are deactivated when staging ends.
6. **Handles.** Unchanged from 0025:89-94: `<handle>.staging.unset.im` stays internal, verified over public DNS TXT.

## Alternatives
- **An internal staging root for the edge, trusted by web only** (architecture, 22:59Z). Sound, and the smallest
  change while the PDS stayed behind the login. Not chosen by Alex on 2026-10-19 at 23:19:26Z: "Lets not use
  certificate internally for now".
- **Let's Encrypt DNS-01 at the edge** (0025:65) with a purchased challenge domain or a Cloudflare token on the
  product zones. Not chosen by Alex for staging; the ruling and ADR 0028 move to production.
- **Rewriting web's PDS calls from `https` to `http` on the internal alias.** Rejected: it changes the sign-in code
  and turns off TLS verification in [SEC] code.
- **Web through Pangolin by public name while the PDS keeps the login.** Rejected: web's back-channel calls (PAR,
  token, XRPC) would need the PDS API past the login, or an ACCEPT-by-IP rule, which 0030 forbids.
- **Keep the Pangolin login on `staging.unset.sh` only.** The shape of this record until 2026-10-20 13:00:31Z. Not
  chosen by Alex: "no need for a Pangolin login for staging right now"; the invite code is the gate.

## Consequences
- The staging milestone needs no Cloudflare token on the host and nothing bought; the DNS provider module and ADR
  0028 are deferred to production.
- Both names stay in the staging Pangolin org, so 0030's Decision 4 (request-log retention 0, the five-field
  access log, log level, failed-attempt logging off) covers their public requests; failed-attempt logging has
  nothing to log, since no login exists.
- Alex's staging list loses the two ACCEPT rules and the tester logins of 0030 and gains nothing: both resources
  are created public. P1.33p's book text (the login probes, the bypass paths, the exemption rules) is rewritten
  in the follow-up this record names in Compliance.
- Every app-to-PDS call leaves the host and returns through Pangolin's WireGuard tunnel to Newt; latency and the
  shared rate-limit bucket of Decision 3 are accepted costs.
- Anyone on the internet can read tester repos, create nothing without an invite, and reach no blob or admin method.
- Chat, media and any later in-stack verifier of the edge come back to architecture for a ruling before they trust
  anything or open a blob path.
- P1.36b (dev edge app site) gains the plain-`http` shape and the denies of Decision 4; P1.37v (#1115) carries the
  bind-address red; the compose change of Decision 3 lands with P1.37v.

## Compliance
- Reds listed in Decisions 2, 3 and 4 land with the steps named in Consequences before staging opens.
- 0030 Decision 1's login-demand probes and its live-resource rule check apply to neither name now (Codex on
  #1127, finding 4319934630, extended to `staging.unset.sh` by Alex's 13:00:31Z words). In their place the deploy
  check reads both resources through Pangolin's API and asserts each is public with no rules at all, so a login
  or an ACCEPT rule added by hand later is caught, and confirms from outside that `staging.unset.sh` answers
  its welcome page and `/oauth-client-metadata.json` without a login, that `staging.unset.ac` answers
  `describeServer` without a login, and that `/xrpc/com.atproto.sync.getBlob` and an `Authorization: Basic`
  request get the edge's deny. That the edge
  presents no certificate and has no `:443` listener cannot be seen from outside, where TLS ends at Pangolin, so
  that assertion runs on the host, in two future steps: the C18 change of Decision 2 (its own typed line) reads
  the edge configuration, and the deploy check that P1.37v brings connects from the `newt_edge` network and
  asserts plain `http` on the bound address and a refused `:443`. On the first deploy and after every Pangolin
  update the same check also asserts that no response from either name carries a `Set-Cookie` from Pangolin: a
  public resource sets no resource session cookie, so 0030 Decision 3's exact-domain guarantee (Codex on #1127,
  finding 4319934639) has nothing to cover, and any such cookie means a login came back.
- ADR 0025 and ADR 0030 change nothing, not even their status lines; this record departs from the clauses of
  0025 and 0030 listed at the top of Decision, for dev only. The C18 change needs Alex's own typed line, separate
  from this record's. Decision 3's key change (P1.37v) lands before either name is created at Pangolin.
- Acceptance line: "yes accept ADR 0031 staging public through Pangolin no login no certificate at our edge
  docs/human/decisions/0031-public-staging-pds.md".
