// What the server sends the screens for a notification (P2.27; rule SE-3: an explicit view type, no domain object).
// `at` is the session's start in UTC with microseconds; the open form sends it back as it came.
export type NotificationView =
  | { readonly kind: "sign_in"; readonly at: string }
  | { readonly kind: "privacy_notice"; readonly version: string };

/** The bell's and the page's data: the entries, the capped unread count, and whether older ones exist. */
export type NotificationsView =
  | {
      readonly state: "ready";
      readonly entries: readonly NotificationView[];
      readonly unread: number;
      readonly more: boolean;
    }
  | { readonly state: "failed" };

const UTC = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const OWN = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * A notification's date and time. The server knows no time zone, so its page says UTC; once the page's script runs,
 * the screen switches to the device's own zone (`local`), and a page with no script keeps the UTC text.
 */
export function timeText(at: string, local: boolean): string {
  const date = new Date(at);
  return local ? OWN.format(date) : `${UTC.format(date)} UTC`;
}

/** The newest sign-in listed: what "Mark all as read" sends, so it covers it and every older one, and none newer. */
export const newestSignIn = (entries: readonly NotificationView[]): string | null =>
  entries.find((entry) => entry.kind === "sign_in")?.at ?? null;

/** The privacy notice version listed, if any, for "Mark all as read". */
export const listedNotice = (entries: readonly NotificationView[]): string | null => {
  const notice = entries.find((entry) => entry.kind === "privacy_notice");
  return notice?.kind === "privacy_notice" ? notice.version : null;
};
