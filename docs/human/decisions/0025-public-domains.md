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

## Decision
The four public domains are:

| Role | Domain |
| --- | --- |
| App | `unset.sh` |
| PDS | `unset.ac` |
| Handles | `unset.im` (`<user>.unset.im`) |
| Chat | `unset.cc` |

Production handles are `<user>.unset.im`. This supersedes `<user>.0x40.me` in decision 0001 Q1.
The development PDS keeps its own suffix and does not mint `.unset.im` handles. This record does
not rename that development host.

The Matrix `server_name` is `unset.cc`. An MXID reads `@localpart:unset.cc`. Chat is served at
`unset.cc`. There is no delegation from `unset.sh` and no `chat.unset.sh` host.

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

## Consequences
- Phase 6 reads `MATRIX_SERVER_NAME` for every MXID. A later change, after an account exists, is a
  migration, not an edit of the constant.
- `unset.cc` and `unset.sh` are different sites. A request from chat to the app is cross-site. The
  CSRF gate already denies cross-site requests.
- `*.unset.im` is the suffix the handle-registry rule will confirm against our PDS. The preflight
  still refuses `.0x40.me` and does not yet require `.unset.im`.
- The step book still spells the old hosts. This record wins for the handle domain and the chat
  host until that book is revised.

## Compliance
`shared/config/permanent.test.ts` pins `MATRIX_SERVER_NAME` and `PERMISSION_SET_NSID` to the rows
above, and pins the answer times. `shared/config/` is code-owned, so a change to `permanent.ts`
routes to Alex. ADR 0020 changes only its status line, to name this record.
