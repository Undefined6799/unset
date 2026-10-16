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

## Compliance
`shared/config/permanent.test.ts` pins `MATRIX_SERVER_NAME` and `PERMISSION_SET_NSID` to the rows
above, and pins the answer times. `shared/config/` is code-owned, so a change to `permanent.ts`
routes to Alex. ADR 0020 changes only its status line, to name this record.
