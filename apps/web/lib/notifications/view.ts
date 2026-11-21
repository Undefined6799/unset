// What the server sends the screens for a notification (P2.27; rule SE-3: an explicit view type, no domain object).
// `reason` is one of the keys of REASON_SCREENS (reasons.ts); `sentAt` is ISO 8601 in UTC.
export type NotificationView = {
  readonly id: string;
  readonly reason: string;
  readonly sentAt: string;
};

/** The bell's and the page's data: the entries, the capped count, and whether older ones exist. */
export type NotificationsView =
  | {
      readonly state: "ready";
      readonly entries: readonly NotificationView[];
      readonly count: number;
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

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const OWN_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const OWN_TIME = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });

/**
 * A row's short time: the time of day for today, else the day ("Nov 17"). The server has no zone, so its page shows
 * the UTC day; with script, `now` is set and the device's zone decides what "today" is.
 */
export function shortTime(at: string, now: Date | undefined): string {
  const date = new Date(at);
  if (now === undefined) return DAY.format(date);
  return OWN_DAY.format(date) === OWN_DAY.format(now) ? OWN_TIME.format(date) : OWN_DAY.format(date);
}
