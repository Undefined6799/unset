// The notifications' English text (P2.27, ADR 0079), until the i18n slice (P1.19). The bell's panel and the
// notifications page say the same things, so both read this file. Each reason's own words are in reasons.ts.
export const NOTIFICATIONS = {
  title: "Notifications",
  /** The bell's accessible name with its count; `n` is capped at 10, so 10 reads as "9+". */
  bell: (n: number): string => (n === 0 ? "Notifications" : `Notifications, ${n >= 10 ? "9+" : n} waiting`),
  badge: (n: number): string => (n >= 10 ? "9+" : String(n)),
  none: "No notifications.",
  noneHint: "New sign-ins and privacy notice changes show up here.",
  failed: "Your notifications could not be loaded. Try again in a moment.",
  visitor: "Sign in to see your notifications.",
  viewAll: "View all notifications",
  dismiss: "Dismiss",
  dismissAll: "Dismiss all",
  dismissSelected: "Dismiss selected",
  selectAll: "Select all",
  select: (title: string): string => `Select: ${title}`,
  count: (n: number, more: boolean): string => `${n}${more ? "+" : ""} notification${n === 1 && !more ? "" : "s"}`,
  more: "Older notifications are not shown. Dismiss all covers them too.",
  when: "When",
  kind: "Kind",
  back: "All notifications",
  stays: "Opening this doesn't remove it. It stays until you dismiss it, or for 30 days.",
  resize: "Resize the list",
} as const;
