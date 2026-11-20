// The notification inbox (P2.27, ADR 0079): what a member is told about their own account, one list for the bell and
// the notifications page. A source sends with `notify`, and that is the only way in. The list, the badge, opening and
// "mark all as read" know nothing about any source, so adding a source changes none of them: it adds its reason to
// REASONS (and to the table's CHECK by migration), its words, icon and link to the screens' reason table
// (apps/web/lib/notifications/reasons.ts, which the type checker holds complete), and calls `notify`.
// The shape follows Bluesky's app.bsky.notification (read in @atproto/api 0.32.5, dist/client/lexicons.js): a list
// per account, newest first, a `reason` per item, and no PDS record; the rows are private server state.

/** Every reason a notification may have. Closed: the database CHECK holds the same list (migration 0036). */
export const REASONS = ["sign_in", "privacy_notice"] as const;
export type Reason = (typeof REASONS)[number];

declare const notificationIdBrand: unique symbol;
/** A notification's id, as the store made it: a UUID. */
export type NotificationId = string & { readonly [notificationIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A form's id, if it has a UUID's shape; anything else is null (rule DM-1). */
export function parseNotificationId(raw: string | null): NotificationId | null {
  return raw !== null && UUID.test(raw) ? (raw as NotificationId) : null;
}

/** What a source sends. No text a person wrote: the screens draw the words from the reason. */
export type Notification = {
  readonly reason: Reason;
  /** What the reason is about, in the reason's own terms (the privacy notice's version). 1 to 64 printable ASCII. */
  readonly topic?: string;
  /** Sending the same key again for the same member keeps one entry. 1 to 128 printable ASCII. */
  readonly dedupeKey?: string;
  /**
   * Only a browser signed in before the entry was sent may see or open it: whoever caused it cannot clear it from the
   * member's other browsers (a new sign-in). Sent in the same transaction as the session it is about.
   */
  readonly olderSessionsOnly?: boolean;
};

/** One entry as the store lists it: only those this browser may see. */
export type Entry = {
  readonly id: NotificationId;
  readonly reason: Reason;
  readonly topic: string | null;
  readonly sentAt: Date;
};

/** The store, bound by the caller to the member and this browser's session (rule AB-2: ports are I/O only). */
export type Inbox = {
  /** Newest first, at most `limit`. */
  readonly list: (limit: number) => Promise<readonly Entry[]>;
  /** Deletes the entry if this browser may see it, and says what it was about. */
  readonly open: (id: NotificationId) => Promise<Entry | null>;
  /** Deletes every entry this browser may see that was sent no later than `upTo`; one sent after it stays. */
  readonly openUpTo: (upTo: NotificationId) => Promise<void>;
};

/** Where a sent notification is stored, bound by the caller to a member (and a transaction, when it needs one). */
export type Outbox = { readonly insert: (notification: Notification) => Promise<void> };

/** The bell's panel shows this many. */
export const BELL_LIMIT = 5;
/** The page shows this many. Marking all as read covers older ones too: it names a time, not a list. */
export const PAGE_LIMIT = 50;
/** The badge counts this far, then reads "9+". */
export const COUNT_CAP = 10;
/** No entry outlives this, opened or not (Alex 2026-11-20 20:22Z): web's sweep deletes older rows. */
export const KEEP_DAYS = 30;

const KEY = /^[\x21-\x7e]+$/;
const fits = (value: string | undefined, max: number): boolean =>
  value === undefined || (value.length <= max && KEY.test(value));

export type NotifyResult = { readonly ok: true } | { readonly ok: false; readonly error: "notification_invalid" };

/** The one way to send a notification. A reason outside the list or an over-long key is refused, never stored. */
export async function notify(outbox: Outbox, notification: Notification): Promise<NotifyResult> {
  if (!(REASONS as readonly string[]).includes(notification.reason))
    return { ok: false, error: "notification_invalid" };
  if (!fits(notification.topic, 64) || !fits(notification.dedupeKey, 128)) {
    return { ok: false, error: "notification_invalid" };
  }
  await outbox.insert(notification);
  return { ok: true };
}

export type NotificationList = {
  /** Newest first. */
  readonly entries: readonly Entry[];
  /** How many are unread, counted up to COUNT_CAP. Every entry listed is unread: an opened one is gone. */
  readonly unread: number;
  /** More exist than `entries` holds. */
  readonly more: boolean;
};

/** Up to `limit` entries, and the count the badge shows, from one read. */
export async function inboxList(inbox: Inbox, limit: number): Promise<NotificationList> {
  const all = await inbox.list(Math.max(limit, COUNT_CAP) + 1);
  return { entries: all.slice(0, limit), unread: Math.min(all.length, COUNT_CAP), more: all.length > limit };
}
