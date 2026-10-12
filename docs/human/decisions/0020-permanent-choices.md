# 0020 — Permanent choices: Matrix server name, Tailnet Lock custody, permission set NSID

Status: Proposed (awaiting Alex's review of the P1.32 pull request). Q1, Q2 and Q4 are Alex's answers of
2026-10-03; Q3 is pending.

PERMANENT: changing any value breaks existing users.

## Context
Some values cannot change once anyone has used them. A Matrix `server_name` is part of every user id
(MXID) forever. A permission set NSID is named in every user's OAuth grant. A WebAuthn RP id is bound
into every passkey enrolled against it. Who holds the Tailnet Lock disablement secrets decides who can
switch the lock off. Step P1.32 asks Alex these questions before any step uses the answers
(`docs/ai/book/phase-1.md`, P1.32; plan §11 Q1, §5.3, §5.7; admin design §4; decision 20). Alex
answered three of the four on 2026-10-03, and the book records each answer with its time. This record
writes them down where code and people find them. `shared/config/permanent.ts` holds the two that code
reads.

## Decision

| # | Choice | Answer | When |
| --- | --- | --- | --- |
| Q1 | Matrix `server_name` | `unset.sh`, with `.well-known` delegation to `chat.unset.sh` | Answered by Alex 2026-10-03 11:50Z |
| Q2 | Who holds the Tailnet Lock disablement secrets | Alex only, two sealed offline copies in separate places | Answered by Alex 2026-10-03 11:52Z |
| Q3 | Admin panel WebAuthn RP id | Pending. The team default is `admin.int.unset.sh` (admin design §4: narrowest scope) | Pending: Alex has not approved it yet |
| Q4 | Permission set NSID | `sh.unset.authApp` | Answered by Alex 2026-10-03 11:47Z |

- `MATRIX_SERVER_NAME` (Q1) and `PERMISSION_SET_NSID` (Q4) are constants in `shared/config/permanent.ts`,
  pinned by `permanent.test.ts`.
- The delegation target `chat.unset.sh` is recorded here, not in `permanent.ts`: delegation can be
  repointed later, and only the `server_name` appears in MXIDs.
- Q2 is custody, not a value any code reads, so it lives only in this record. P1.33 generates the
  secrets.
- Q3 gains `ADMIN_RP_ID` in `permanent.ts`, and a row update here, once Alex answers. Only the admin
  phase depends on it; nothing in sign-in does.
- The permission set grows by editing the set under the same NSID, never by a new NSID (P1.31).

## Alternatives
- Q1 (b) `chat.unset.sh` as the `server_name`: longer MXIDs for no gain, since `.well-known`
  delegation is standard (plan §11 Q1).
- Q2 (b) Alex plus Tailscale's support copy: a third party could then disable the lock.
- Q3 (b) `int.unset.sh`: any `*.int.unset.sh` host could then request an admin's passkey.
- Q4 (b) another NSID Alex picks: none was offered; `sh.unset.authApp` is flat and fits the
  `_lexicon.unset.sh` authority.

## Consequences
- Phase 6 takes `MATRIX_SERVER_NAME` for every MXID. P1.31 and P1.35 take `PERMISSION_SET_NSID` for
  the permission set and the OAuth scope string. P1.33 follows Q2.
- Changing a constant means editing `permanent.test.ts` against a new record that supersedes this one.
  For every account already created, the change is a migration, not an edit.
- The admin phase (Phase 3) cannot start its passkey step until Q3 is answered.

## Compliance
- `shared/config/permanent.test.ts`: `permanent_constants_pinned` checks each constant against its row
  here, and `permanent_doc_has_dates` checks that each answered row carries Alex's answer time and that Q3
  is marked pending.
- `shared/config/` is code-owned (CODEOWNERS), so a change to `permanent.ts` routes to Alex.
