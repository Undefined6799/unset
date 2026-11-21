---
title: notifications
weight: 3
---

The member's notification inbox: the one way to send into it, and the list the navbar bell and the notifications page read. Package `@unset/domains-notifications`. The design is [ADR 0079](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0079-notifications-in-core.md), Accepted, with point 3 amended by [ADR 0081](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0081-notifications-stay-until-dismissed.md), Proposed: an entry stays until the member dismisses it.

## Owns

The closed list of reasons, what a notification may carry, the list's caps and how long an entry lives. The rows are in `app.notification` (migration 0036), behind `infrastructure/postgres/notificationStore.ts`; this folder opens no socket.

| Module | What it holds |
| --- | --- |
| `domains/notifications/index.ts` | Package root. Re-exports the names below. |
| `domains/notifications/notifications.ts` | `notify` (the send call), `inboxList`, `REASONS`, `parseNotificationId`, `parseNotificationIds`, the `Inbox` (list, dismiss, dismiss up to) and `Outbox` ports, `BELL_LIMIT` (5), `PAGE_LIMIT` (50), `DISMISS_MAX` (50), `COUNT_CAP` (10), `KEEP_DAYS` (30). |

| Reason | Sent by |
| --- | --- |
| `sign_in` | The OAuth callback, in the transaction that makes the session; only browsers signed in before it see it. |
| `privacy_notice` | The OAuth callback, once per notice version, when the changed-notice banner would show; withdrawn when the banner is dismissed. |

A notification carries a reason, an optional topic (1 to 64 printable ASCII characters) and an optional dedupe key (1 to 128). Nothing a person typed is stored: the words come from the screens' reason table.
