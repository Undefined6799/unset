// The notifications' English text (P2.27, ADR 0079), until the i18n slice (P1.19). The bell's panel and the
// notifications page say the same things, so both read this file.
export const NOTIFICATIONS = {
  title: "Notifications",
  /** The bell's accessible name with its count; `n` is capped at 10, so 10 reads as "9+". */
  bell: (n: number): string => (n === 0 ? "Notifications" : `Notifications, ${n >= 10 ? "9+" : n} unread`),
  badge: (n: number): string => (n >= 10 ? "9+" : String(n)),
  lead: "What happened on your account. Opening one removes it.",
  none: "No new notifications.",
  failed: "Your notifications could not be loaded. Try again in a moment.",
  visitor: "Sign in to see your notifications.",
  viewAll: "View all notifications",
  markAll: "Mark all as read",
  more: "Older notifications are not shown. Marking all as read covers them too.",
  signIn: "New sign-in to your account",
  signInHint: "Not you? Sign out everywhere in Settings.",
  privacyNotice: "We updated our privacy notice",
  privacyNoticeHint: "Read what changed.",
} as const;
