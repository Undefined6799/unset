# 0025 — Public domains

Status: Proposed (awaiting Alex)

PERMANENT — changing any value breaks existing users.

## Context
Alex stated the four public domains on 2026-10-16 22:42Z. Decision 0001 Q1 still records production
handles as `<user>.0x40.me`. ADR 0020 Q1 still records the Matrix `server_name` as `unset.sh`, with
`.well-known` delegation to `chat.unset.sh`. No Matrix account has been created, so the server name
can still be edited rather than migrated (ADR 0020's own rule).

A homeserver is identified by its server name, and that name is the domain in every user id
(`@localpart:domain`). Matrix spec, Server Name and User Identifiers, read 2026-10-16:
https://spec.matrix.org/latest/appendices/#server-name

The same evening, at 22:57Z, Alex named the development system. The 22:42Z statement had left that
host as the earlier record had it.

## Decision
The four public domains are:

| Role | Domain |
| --- | --- |
| App | `unset.sh` |
| PDS | `unset.ac` |
| Handles | `unset.im` (`<user>.unset.im`) |
| Chat | `unset.cc` |

Production handles are `<user>.unset.im`. This supersedes `<user>.0x40.me` in decision 0001 Q1.

The development system is the same four roles under the label `staging`. Each host is a subdomain
of one public domain, not a fifth registration. Alex named it on 2026-10-16 22:57Z.

| Role | Development host |
| --- | --- |
| App | `staging.unset.sh` |
| PDS | `staging.unset.ac` |
| Handles | `staging.unset.im` (`<user>.staging.unset.im`) |
| Chat | `staging.unset.cc` |

The development PDS mints `<user>.staging.unset.im` and does not mint `.unset.im`. The local
throwaway stack stays on `.localhost`. It is not this system.

The development system runs on Alex's homelab, with invites still required. Alex chose "Tailnet only" on
2026-10-19 at 02:05:05Z on the card "Choose who can reach staging on your homelab during live tests". His
words of 2026-10-19 at 02:39:57Z and 02:50:36Z replace that tap for the app and the PDS: `staging.unset.sh`
and `staging.unset.ac` are published through his Pangolin instance behind its user login, one SSO login per
tester rather than a shared password, and the handle hosts `*.staging.unset.im` stay internal. He kept the
login on 2026-10-19 at 02:56:58Z ("Keep password" on the card "Keep the Pangolin password on staging, or
open it with invites only?"); opening staging without it would be P1.33p's public opening, pulled forward.
Architecture ruled on names and certificates on 2026-10-19 at 02:35Z, on 2026-10-19 at 03:24Z added that
staging tests only accounts on its own PDS, on 2026-10-19 at 03:35Z, 03:40Z, 04:00Z, 04:05Z and 04:10Z
ruled on Pangolin, the tester handles, the remaining CAA records and the DNS the staging names need, and on
2026-10-19 at 05:15Z ruled that the own-PDS rule is enforced in the app.
Until P1.33p, the app signs in only accounts on our own PDS, and checks this in code: before authorize, the
account's PDS must be our own issuer exactly, or the app refuses and sends nothing to the outside server;
at the callback, the issuer and the account's PDS must still match. The check applies in every environment
with no switch, and is a product step beside P1.36i that lands before staging opens. The Pangolin login is
a second layer, not the boundary. Opening sign-in to outside accounts is P1.33p, with its own ruling and
Alex's word.

- The edge's own certificates for the `staging.unset.*` names are Let's Encrypt with the DNS-01
  challenge, validated through a delegated zone: `_acme-challenge.staging.unset.*` is a CNAME into a
  dedicated validation zone, and the edge's DNS token can write only that zone, never the product
  zones. The public certificates that Pangolin presents for `staging.unset.sh` and `staging.unset.ac`
  are its own, issued by HTTP-01 (below). The local development root is not used for these names.
- `staging.unset.sh` is published through Pangolin behind its login. Exactly two paths bypass the
  login, for GET and HEAD, by exact match and never by wildcard: `/oauth-client-metadata.json` and the
  client's `jwks_uri` path. They are the same two public documents every atproto client publishes, and a
  test pins that the app serves them and that nothing else under them is public. `/oauth/callback` does
  not bypass. Pangolin terminates public TLS with its own Let's Encrypt certificate for this one host,
  issued by HTTP-01, and connects upstream over HTTPS through Newt to the edge's existing loopback bind,
  with certificate verification on and SNI `staging.unset.sh`; no new port is published. The edge keeps
  its own DNS-01 certificate for the name. Under dev the edge drops the app-host alias, so the PDS resolves
  `staging.unset.sh` through public DNS to Pangolin's public address and its metadata fetch passes the
  unicast check; no split-horizon static host is needed for this name. The PDS-host alias stays.
- `staging.unset.ac` is published through the same Pangolin behind the same login, with no bypass at
  all: a tester's browser reaches the PDS's authorize and account pages with the Pangolin cookie, and the
  app reaches the PDS internally through the edge's PDS alias, the one exact host net-guard allows.
  Staging is own-PDS-only, so no outside server needs the PDS. Its TLS is the same two hops as the app
  name's. No PDS port is published.
- A tester's handle `<handle>.staging.unset.im` resolves through a public DNS TXT record
  `_atproto.<handle>.staging.unset.im`, one per tester, which Alex adds through the runbook. Handle
  verification in the app runs over public DNS through net-guard, which keeps refusing private and
  CGNAT addresses, so the handle hosts themselves stay internal with no wildcard certificate at Pangolin
  and no new bypass. The alternative, `*.staging.unset.im` through Pangolin with one
  `/.well-known/atproto-did` bypass, is not taken.
- No split DNS is needed for the staging names: public DNS serves `staging.unset.sh` and
  `staging.unset.ac`, the testers' handles resolve through their public `_atproto` TXT records, and
  inside the stack the names resolve through Docker aliases on the edge.
- Public DNS holds, for `staging.unset.sh` and `staging.unset.ac`: an A/AAAA record pointing at the
  Pangolin host, the `_acme-challenge` CNAME into the validation zone, and the CAA records below. For
  `staging.unset.im` it holds the `_acme-challenge` CNAME, its CAA records and the testers' `_atproto`
  TXT records. For `staging.unset.cc` it holds the `_acme-challenge` CNAME and its CAA records.
- CAA lookup climbs to the closest parent record (RFC 8659), and `unset.ac` stays parked at
  `CAA 0 issue ";"` until P5.02a, so every staging name carries its own CAA. `staging.unset.sh` and
  `staging.unset.ac` each carry exactly three records:
  `CAA 0 issue "letsencrypt.org; validationmethods=dns-01"` for the edge's certificate,
  `CAA 0 issue "letsencrypt.org; validationmethods=http-01"` for Pangolin's certificate and
  `CAA 0 issuewild ";"`. `staging.unset.im` carries
  `CAA 0 issue "letsencrypt.org; validationmethods=dns-01"` plus
  `CAA 0 issuewild "letsencrypt.org; validationmethods=dns-01"` for `*.staging.unset.im`, the only staging
  wildcard. `staging.unset.cc` carries `CAA 0 issue "letsencrypt.org; validationmethods=dns-01"` and
  `CAA 0 issuewild ";"`, and gains Pangolin's issuer if chat is later routed through Pangolin. Each
  `letsencrypt.org` record gains `accounturi=` once its ACME account exists (RFC 8657). The parked apex
  records are unchanged.

The Matrix `server_name` is `unset.cc`. An MXID reads `@localpart:unset.cc`. Chat is served at
`unset.cc`. There is no delegation from `unset.sh` and no `chat.unset.sh` host.

The development homeserver's server name is `staging.unset.cc`, so a development MXID reads
`@localpart:staging.unset.cc`. That name is not `MATRIX_SERVER_NAME`. The permanent constant
stays `unset.cc`.

The permanent choices, restated so this record carries the ones it does not change:

| # | Choice | Answer | When |
| --- | --- | --- | --- |
| Q1 | Matrix `server_name` | `unset.cc` | Answered by Alex 2026-10-16 22:42Z |
| Q2 | Who holds the Tailnet Lock disablement secrets | Alex only, two sealed offline copies in separate places | Answered by Alex 2026-10-03 11:52Z |
| Q4 | Permission set NSID | `sh.unset.authApp` | Answered by Alex 2026-10-03 11:47Z |

`MATRIX_SERVER_NAME` in `shared/config/permanent.ts` is `unset.cc`. `PERMISSION_SET_NSID` is
unchanged. This record supersedes ADR 0020.

## Alternatives
- Keep `server_name` as `unset.sh` and point `.well-known` at `unset.cc`. Rejected: chat has one
  domain, and no MXID exists yet, so the name in the id and the name of the service are the same.
- Keep production handles on the prototype suffix. Rejected: Alex assigned handles to `unset.im`.
- Keep the development PDS on the prototype host. Rejected: Alex named the development system
  `staging.unset.*`.
- Register a separate domain for development. Rejected: development is a label under the four
  public domains.
- Issue the staging certificates from the local development root. Rejected: that root is
  name-constrained to `.localhost` (P1.35p), so it cannot issue for `staging.unset.*`, and a second
  root installed on testers' devices is a far larger trust grant than a public certificate.
- Resolve the staging names in public DNS to the homelab. Rejected: the app and PDS names point at
  Pangolin, not the homelab, and the handle hosts stay internal, so public DNS carries only the
  records the Decision lists for these names.
- Keep the PDS tailnet-only and have testers join the tailnet. Rejected by Alex on 2026-10-19 at
  02:50:36Z ("no tailnet for the pds either"); architecture's reason for agreeing is that a browser
  has to reach the PDS's authorize page, and Pangolin already fronts the app.
- Serve the client metadata and public keys from a separate split-horizon static host. Retired for the
  app name: Pangolin's two bypass paths serve the same two documents from the app's own origin.

## Consequences
- Phase 6 reads `MATRIX_SERVER_NAME` for every production MXID. A later change, after an account
  exists, is a migration, not an edit of the constant. A development account's id uses
  `staging.unset.cc` and is not that constant.
- `unset.cc` and `unset.sh` are different sites. A request from chat to the app is cross-site. The
  CSRF gate already denies cross-site requests.
- `staging.unset.sh` and `unset.sh` are same site, and `staging.unset.ac` and `unset.ac` are same
  site. Two https origins are same site when their hosts share a registrable domain (HTML, "same
  site", read 2026-10-16, https://html.spec.whatwg.org/multipage/browsers.html#schemefully-same-site).
  The app's cookies are host-only `__Host-` cookies: that prefix requires no `Domain` attribute, and
  a cookie with no `Domain` attribute is returned only to the host that set it
  (draft-ietf-httpbis-rfc6265bis, "The __Host- Prefix" and the Domain attribute, read 2026-10-16,
  https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html#name-the-__host-prefix).
  The production app cookie is not sent to `staging.unset.sh`. The CSRF gate denies `same-site` as
  well as `cross-site`. Do not set a `Domain` attribute.
- A configured PDS handle domain matches by suffix, and only one label may sit in front of it
  (`@atproto/pds` 0.5.37 `packages/pds/src/handle/index.ts`, `isServiceDomain` and
  `ensureHandleServiceConstraints`, read 2026-10-16,
  https://github.com/bluesky-social/atproto/blob/%40atproto/pds%400.5.37/packages/pds/src/handle/index.ts).
  Production, configured with `.unset.im`, refuses `alice.staging.unset.im` because the front
  contains a dot. Development, configured with `.staging.unset.im`, does not accept
  `alice.unset.im`. The word `staging` is already in that PDS's reserved-label list
  (`packages/pds/src/handle/reserved.ts`), so production also refuses the handle `staging.unset.im`.
- `*.unset.im` is the suffix the handle-registry rule will confirm against our production PDS.
  The preflight still refuses `.0x40.me`, still requires `.0x40.space` for a dev-stage handle
  domain, and does not yet require `.unset.im` or `.staging.unset.im`. The check that the
  prototype host `0x40.space` needs the retirement report stays as it is.
- The step book still spells the old hosts. This record wins for the handle domain, the chat
  host and the development hosts until that book is revised.
- The staging names appear in Certificate Transparency logs. They are already public in this
  record, so the logs reveal nothing new.
- The Pangolin host is inside the staging trust boundary: it sees decrypted session cookies and OAuth
  codes, so no production data or production account ever touches staging. Its conditions are Alex's,
  on the runbook: a patched Pangolin at 1.24.0 or later (the first release whose rules match HTTP
  methods) with share links off, MFA on its admin login, one Pangolin login per tester rather than a
  shared password, host-only cookies on the resource name
  (never `Domain=unset.sh`), forwarded headers set by Pangolin alone and trusted by the edge only from
  Newt's fixed address, short retention and a RoPA line for its access logs, and testers told it is a
  test system. Our own gates stay: invites, the email and onboarding gates, our OAuth session, the CSRF
  and Origin gates, owner-only `/<DID>`, no published PDS port.
- Let's Encrypt stays the only issuer of our own certificates. C18 accepts DNS-01 for the dev profile
  first (P1.36e, a trusted-base step); production's handle wildcard `*.unset.im` and its internal
  admin host (PLAN.md:440) use the same delegated-zone pattern when Phase 5 builds them, each with
  its own typed line. P1.36e leaves the local stack and production's current challenges as they are.
  Here the dev profile is the development system (the preflight's `--env dev`), not the local stack,
  which also sets `UNSET_ENV=dev`.
- The edge's DNS-01 certificates need one DNS provider module in the edge image. Accepted ADR 0018
  allows one third-party module, so that module is ADR 0028's decision, not this record's; P1.36d
  waits on Alex's acceptance of ADR 0028. The zone-scoped DNS token is Alex's to create; it is a C9
  file secret mounted only into the edge (P1.36c).

## Compliance
`shared/config/permanent.test.ts` pins `MATRIX_SERVER_NAME` and `PERMISSION_SET_NSID` to the rows
above, and pins the answer times. `shared/config/` is code-owned, so a change to `permanent.ts`
routes to Alex. ADR 0020 changes only its status line, to name this record.
