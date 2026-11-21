// The notifications' English text (P2.27, ADR 0079), until the i18n slice (P1.19). The bell's panel and the
// notifications page say the same things, so both read this file. Each reason's own words are in reasons.ts.
export const NOTIFICATIONS = {
  title: "Notifications",
  /** The bell's accessible name with its count; `n` is capped at 10, so 10 reads as "9+". */
  bell: (n: number): string => (n === 0 ? "Notifications" : `Notifications, ${n >= 10 ? "9+" : n} waiting`),
  badge: (n: number): string => (n >= 10 ? "9+" : String(n)),
  none: "No notifications.",
  /**
   * A sign-in's entry is shown only in the browsers signed in before it (migration 0036 `older_sessions_only`), so
   * whoever signed in cannot clear it; the browser that just signed in never sees its own (staging test 2026-11-21).
   */
  noneHint: "Privacy notice changes show up here, and so does a new sign-in from another browser or device.",
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

/** The two tabs of /notifications (P2.27c). */
export const NOTIFICATION_TABS = {
  label: "Notifications and sign-ins",
  notifications: "Notifications",
  signIns: "Sign-in history",
} as const;

/** The Sign-in history tab (P2.27c, ADR 0082). */
export const SIGN_INS = {
  title: "Sign-in history",
  failed: "Your sign-in history could not be loaded. Try again in a moment.",
  none: "No sign-ins in the last 30 days.",
  noneHint: "Each time someone signs in to your account, the time shows up here.",
  when: "When",
  ago: "How long ago",
  select: (when: string): string => `Select the sign-in on ${when}`,
  selectAll: "Select all",
  delete: "Delete",
  deleteOne: (when: string): string => `Delete the sign-in on ${when}`,
  deleteSelected: "Delete selected",
  deleteAll: "Delete all",
  count: (n: number, more: boolean): string => `${n}${more ? "+" : ""} sign-in${n === 1 && !more ? "" : "s"}`,
  more: "Older sign-ins are not shown. Delete all covers them too.",
  kept: "Only the time of each sign-in is kept: no address, device or location. Each one is deleted after 30 days, or sooner if you delete it.",
  notYou: "A sign-in you don't recognise? Sign out everywhere and change your password with your provider.",
  settings: "Account settings",
} as const;
