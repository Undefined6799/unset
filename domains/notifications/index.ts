// Notifications (P2.27, ADR 0079): the member's inbox. Sources send with `notify`; the screens list, open and mark all
// as read through `Inbox`, and none of that changes when a source is added.
export {
  BELL_LIMIT,
  COUNT_CAP,
  type Entry,
  type Inbox,
  inboxList,
  KEEP_DAYS,
  type Notification,
  type NotificationId,
  type NotificationList,
  type NotifyResult,
  notify,
  type Outbox,
  PAGE_LIMIT,
  parseNotificationId,
  REASONS,
  type Reason,
} from "./notifications.ts";
