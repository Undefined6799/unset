---
title: notifications
weight: 3
---

What a member is told about their own account, as one list for the navbar bell and the notifications page. Package `@unset/domains-notifications`. The design is [ADR 0079](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0079-notifications-in-core.md), Proposed.

## Owns

The list's order, its caps and the one time a form may send. Nothing here is stored and this folder opens no socket.

| Module | What it holds |
| --- | --- |
| `domains/notifications/index.ts` | Package root. Re-exports the names below. |
| `domains/notifications/notifications.ts` | `notificationsFor`, `parseSignInAt`, `BELL_LIMIT` (5), `PAGE_LIMIT` (50), `COUNT_CAP` (10), and the entry types. |

| Entry | Comes from |
| --- | --- |
| `sign_in` | Another live session of the member that began after this browser's and after this browser last opened its sign-in entries (`infrastructure/session` `newerSignIns`, `app.session.sign_ins_seen_at`). |
| `privacy_notice` | The privacy notice changed since the member dismissed it (`app.account.privacy_notice_seen_version`). |

`parseSignInAt` accepts only the store's exact shape, ISO 8601 in UTC with six decimals, so opening an entry names its own session and no later one.
