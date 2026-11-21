// The notification inbox (P2.27, ADR 0079): what a member is told about their own account, one list for the bell and
// the notifications page. A source sends with `notify`, and that is the only way in. The list, the badge and
// dismissing know nothing about any source, so adding a source changes none of them: it adds its reason to
// REASONS (and to the table's CHECK by migration), its words, icon and link to the screens' reason table
// (apps/web/lib/notifications/reasons.ts, which the type checker holds complete), and calls `notify`.
// The shape follows Bluesky's app.bsky.notification (read in @atproto/api 0.32.5, dist/client/lexicons.js): a list
// per account, newest first, a `reason` per item, and no PDS record; the rows are private server state.

/** Every reason a notification may have. Closed: the database CHECK holds the same list (migrations 0036, 0039). */
export const REASONS = ["sign_in", "privacy_notice", "invite_mail_failed"] as const;
export type Reason = (typeof REASONS)[number];

declare const notificationIdBrand: unique symbol;
/** A notification's id, as the store made it: a UUID. */
export type NotificationId = string & { readonly [notificationIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A form's id, if it has a UUID's shape; anything else is null (rule DM-1). */
export function parseNotificationId(raw: string | null): NotificationId | null {
  return raw !== null && UUID.test(raw) ? (raw as NotificationId) : null;
}

/**
 * The ids a "Dismiss selected" form sends: those with a UUID's shape, each once, at most DISMISS_MAX (the page lists no
 * more). Anything else is dropped, so a form naming nothing valid dismisses nothing (rule DM-1).
 */
export function parseNotificationIds(raw: readonly string[]): NotificationId[] {
  const ids = new Set<NotificationId>();
  for (const value of raw) {
    const id = parseNotificationId(value);
    if (id !== null) ids.add(id);
    if (ids.size === DISMISS_MAX) break;
  }
  return [...ids];
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
  /** Deletes those of `ids` this browser may see, and says which they were. */
  readonly dismiss: (ids: readonly NotificationId[]) => Promise<readonly Entry[]>;
  /** Deletes every entry this browser may see sent no later than `upTo`, and says which; one sent after stays. */
  readonly dismissUpTo: (upTo: NotificationId) => Promise<readonly Entry[]>;
};

/** Where a sent notification is stored, bound by the caller to a member (and a transaction, when it needs one). */
export type Outbox = { readonly insert: (notification: Notification) => Promise<void> };

/** The bell's panel shows this many. */
export const BELL_LIMIT = 5;
/** The page shows this many. Dismiss all covers older ones too: it names a time, not a list. */
export const PAGE_LIMIT = 50;
/** One "Dismiss selected" names at most this many: everything the page lists. */
export const DISMISS_MAX = PAGE_LIMIT;
/** The badge counts this far, then reads "9+". */
export const COUNT_CAP = 10;
/** No entry outlives this, dismissed or not (Alex 2026-11-20 20:22Z): web's sweep deletes older rows. */
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
  /** How many this browser has, counted up to COUNT_CAP: an entry stays until it is dismissed (ADR 0081). */
  readonly count: number;
  /** More exist than `entries` holds. */
  readonly more: boolean;
};

/** How many entries a read for a list of `limit` takes: enough to show it, count the badge and know of more. */
export const readSize = (limit: number): number => Math.max(limit, COUNT_CAP) + 1;

/**
 * The bell's read: the session read brings this many newest entries with it (infrastructure/session/store.ts), so a
 * page spends no statement of its own on the bell.
 */
export const BELL_READ = readSize(BELL_LIMIT);

/** Up to `limit` entries and the badge's count, from a newest-first read of `readSize(limit)` entries. */
export function listOf(read: readonly Entry[], limit: number): NotificationList {
  return { entries: read.slice(0, limit), count: Math.min(read.length, COUNT_CAP), more: read.length > limit };
}

/** Up to `limit` entries, and the count the badge shows, from one read. */
export async function inboxList(inbox: Inbox, limit: number): Promise<NotificationList> {
  return listOf(await inbox.list(readSize(limit)), limit);
}
