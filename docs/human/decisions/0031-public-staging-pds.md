# 0031 — Staging PDS public through Pangolin, no certificate at our edge

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

Why that removes the certificate question: Pangolin terminates public TLS for both names with its own Let's Encrypt
certificates and does not verify the edge's certificate (0030, Context). The one client inside the stack that did
verify the edge's certificate was web reaching the PDS through the edge's PDS alias (0025:86). With the PDS public,
web can reach it by its public name through Pangolin, verifying Pangolin's certificate with the normal trust store,
exactly as the PDS already fetches the app's client metadata (0025:81-83). Nothing in the stack then verifies the
edge's certificate, so under dev the edge needs none. Architecture ruled this shape at 23:22Z
(`unset-plan/book-edits/2026-10-19-staging-tailnet-rulings.md`).

## Decision
This record departs from ADR 0025 at the two clauses above and from ADR 0030's "no bypass" sentence, for the dev
profile only. Neither record is edited; both keep their status. Production is unchanged: `unset.ac` stays behind
whatever ADR 0028 and the Phase 5 records decide, with Let's Encrypt at the edge.

1. **Pangolin.** `staging.unset.ac` is a public resource at Pangolin: no login, no rules. `staging.unset.sh` keeps
   the tester login and exactly the two ACCEPT rules of 0030. Never an ACCEPT-by-IP rule on `staging.unset.sh`:
   anyone sharing Alex's egress address would skip the login. Pangolin's targets to Newt are plain `http`; Pangolin
   does not verify the edge in any case (0030).
2. **Edge without a certificate under dev.** Under dev the edge's two sites listen on plain `http`, bound only to
   the edge's address on the internal `newt_edge` network (0030, Decision 2), with no published port and no `:443`
   site. Preflight C18 under dev checks exactly that shape and under prod keeps refusing anything but Let's Encrypt;
   a plain-`http` site under prod is a preflight failure. The app and the PDS never derive their scheme from the
   request: cookies stay `Secure`, and the OAuth issuer, the client metadata URLs and every public URL stay `https`
   from configuration. Both sites still send the security headers. Reds, each in `deployment/edge` or preflight
   tests: the bind address and the absent port; no `:443` site under dev; prod refuses plain `http`; scheme never
   taken from the request (app and PDS configuration); headers present on both sites. The `_acme-challenge`
   CNAMEs of 0025:65-71 are not created for staging, and the CAA records on both staging names drop the edge's
   `dns-01` issuer line (a tightening); Pangolin's `http-01` line stays as 0025 lists it. ADR 0028 and the
   validation-domain ruling of 21:52Z apply to production, where `*.unset.im` still needs DNS-01; that question
   returns before Phase 5. P1.36e, P1.36o and the DNS provider steps move to production.
3. **In-stack hop through Pangolin.** Under dev the compose file drops the PDS-host alias on the edge, symmetrical
   with the app-host alias it already drops (0025:81-83), so web resolves `staging.unset.ac` through public DNS to
   Pangolin and reaches the PDS through Pangolin, Newt and the edge. net-guard loses its one internal-host
   exception (`infrastructure/net-guard/src/policies.ts:11`) on staging, a tightening: every host web fetches must
   resolve to public unicast addresses. No `NODE_EXTRA_CA_CERTS` anywhere on staging (a red: no staging service
   names a dev root). Rate limits: web gets no IP allowlist and no Pangolin bypass; the edge's keys stay on
   `client_ip` (0025:186-194); the `staging.unset.ac` zones are sized from web's measured peak plus headroom. Alex's
   own browser shares a bucket with web, since both arrive from his egress address, so a `429` for him is a known
   cost. A CrowdSec or rate-limit allowlist for his egress address would be a loosening that needs his own typed
   line; until then the limits fail closed.
4. **What `staging.unset.ac` exposes, and what the edge denies.** Public: every XRPC method the PDS serves
   (`com.atproto.server.*`, `repo.*`, `sync.*` including `subscribeRepos` and `getRepo`, `identity.*`), the OAuth
   endpoints (`/oauth/authorize`, PAR, token, `/.well-known/oauth-authorization-server`,
   `/.well-known/oauth-protected-resource`) and the PDS account pages. Under dev the edge denies on
   `staging.unset.ac`: (i) any request carrying `Authorization: Basic`, because admin authentication is Basic and
   some admin-authenticated methods sit outside `com.atproto.admin` (`com.atproto.server.createInviteCode`,
   `createInviteCodes`); `/xrpc/com.atproto.admin.*` and `/xrpc/com.atproto.temp.*` are denied as well; the runbook
   runs admin calls from the staging host against the PDS container, never the public name; (ii) until P5.07b's
   real scan exists, `com.atproto.repo.uploadBlob`, `com.atproto.sync.getBlob` and `com.atproto.repo.importRepo`,
   because a public `getBlob` would make an unscanned public image host, which the 20:58Z ruling, our zero tolerance
   for CSAM and the vault note `research/atproto-blob-serving-security` forbid. No media is in this milestone, so
   nothing breaks; a blob path that opens later carries the sandbox CSP and `nosniff`. Each deny gets a property-test
   red (TE-6) covering case, percent-encoding, trailing-slash and doubled-slash variants, in the shape of 0030's
   probe groups. Still holding: `PDS_INVITE_REQUIRED` (open sign-up waits on P5.02a), the admin password usable
   only from the host, the PDS's own rate limits and the edge's, the app behind the Pangolin login, own-PDS-only
   sign-in (P1.36v, never waived), and no media in the milestone.
5. **Federation.** `PDS_CRAWLERS` stays empty, so the PDS requests no crawl; relays that find tester repos through
   `plc.directory` may still subscribe, and tester repos are public atproto data (ADR 0004). No mitigation. The
   runbook says how tester accounts are deactivated when staging ends.
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
  token, XRPC) would need the PDS API past the login, or an ACCEPT-by-IP rule, which Decision 1 forbids.

## Consequences
- The staging milestone needs no Cloudflare token on the host and nothing bought; the DNS provider module and ADR
  0028 are deferred to production.
- Every app-to-PDS call leaves the host and returns through Pangolin's WireGuard tunnel to Newt; latency and the
  shared rate-limit bucket of Decision 3 are accepted costs.
- Anyone on the internet can read tester repos, create nothing without an invite, and reach no blob or admin method.
- Chat, media and any later in-stack verifier of the edge come back to architecture for a ruling before they trust
  anything or open a blob path.
- P1.36b (dev edge app site) gains the plain-`http` shape and the denies of Decision 4; P1.37v (#1115) carries the
  bind-address red; the compose change of Decision 3 lands with P1.37v.

## Compliance
- Reds listed in Decisions 2, 3 and 4 land with the steps named in Consequences before staging opens.
- The live deploy checks of 0030 keep running; a third check confirms, from outside, that `staging.unset.ac`
  answers `describeServer` without a login, that `/xrpc/com.atproto.sync.getBlob` and an `Authorization: Basic`
  request get the edge's deny, and that the edge presents no certificate of its own.
- ADR 0025 and ADR 0030 change nothing, not even their status lines; this record departs from two clauses of 0025
  and one sentence of 0030 for dev only. The C18 change needs Alex's own typed line, separate from this record's.
- Acceptance line: "yes accept ADR 0031 staging PDS public through Pangolin no certificate at our edge
  docs/human/decisions/0031-public-staging-pds.md".
