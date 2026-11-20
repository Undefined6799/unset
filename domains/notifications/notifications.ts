// The notification list (P2.27, ADR 0079). Two kinds exist, both derived and neither stored, so there is nothing to
// keep, export or erase beyond what the app already holds (plan §6: no sign-in records):
// - `sign_in`: another live session of this member began after the one this browser holds and after this browser
//   last opened its sign-in entries. The session row is the only record; when it ends, its entry goes with it, so an
//   entry lasts at most a session's 30 days.
// - `privacy_notice`: the privacy notice changed since the member dismissed it (P2.12b's seen column).
// The shape follows Bluesky's app.bsky.notification.listNotifications (@atproto/api 0.32.5 lexicons.js): one list per
// account, newest first, with a `reason` per item. Ports are I/O only (rule AB-2); the interface binds them to the
// request's session.

declare const signInAtBrand: unique symbol;
/**
 * When a session began, exactly as Postgres keeps it: ISO 8601 in UTC with microseconds. Exact, so an entry that is
 * opened names its own session's start and no later one; a millisecond Date would round it and miss.
 */
export type SignInAt = string & { readonly [signInAtBrand]: true };

const SIGN_IN_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** A form's `at`, if it has the store's exact shape and names a real instant; anything else is null (rule DM-1). */
export function parseSignInAt(raw: string | null): SignInAt | null {
  if (raw === null || !SIGN_IN_AT.test(raw) || Number.isNaN(Date.parse(raw))) return null;
  return raw as SignInAt;
}

export type NotificationEntry =
  | { readonly kind: "sign_in"; readonly at: SignInAt }
  | { readonly kind: "privacy_notice"; readonly version: string };

export type NotificationSources = {
  /** The other sessions' start times, newest first, at most `limit` (see `sign_in` above). */
  readonly signIns: (limit: number) => Promise<readonly SignInAt[]>;
  /** The privacy notice version to tell the member about, or null when they have seen this build's. */
  readonly privacyNotice: string | null;
};

/** The bell's panel shows this many. */
export const BELL_LIMIT = 5;
/** The page shows this many. Marking all as read covers older ones too: it moves one time, not a list. */
export const PAGE_LIMIT = 50;
/** The badge counts this far, then reads "9+". */
export const COUNT_CAP = 10;

export type NotificationList = {
  /** Newest first; the privacy notice, which has no time of its own, comes first. */
  readonly entries: readonly NotificationEntry[];
  /** How many are unread, counted up to COUNT_CAP. Every entry listed is unread: an opened one is gone. */
  readonly unread: number;
  /** More exist than `entries` holds. */
  readonly more: boolean;
};

/** Up to `limit` entries for the member, and the count the badge shows. One read of the sessions. */
export async function notificationsFor(sources: NotificationSources, limit: number): Promise<NotificationList> {
  const notice: NotificationEntry[] =
    sources.privacyNotice === null ? [] : [{ kind: "privacy_notice", version: sources.privacyNotice }];
  // One more than either needs, so `more` and the capped count come from the same read.
  const signIns = await sources.signIns(Math.max(limit, COUNT_CAP) + 1);
  const all = [...notice, ...signIns.map((at): NotificationEntry => ({ kind: "sign_in", at }))];
  return {
    entries: all.slice(0, limit),
    unread: Math.min(all.length, COUNT_CAP),
    more: all.length > limit,
  };
}
