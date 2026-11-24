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

/**
 * The bell's data in the shell. A page that runs the client is sent the entries, which its panel draws; a page that
 * runs none draws the bell as a link with its count, so it is sent the count and no entry (book P1.22g, rule SE-3).
 */
export type BellView = NotificationsView | { readonly state: "count"; readonly count: number };

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

/** A sign-in as the Sign-in history tab shows it (P2.27c, ADR 0082): its id and when, ISO 8601 in UTC. Nothing else is kept. */
export type SignInView = { readonly id: string; readonly at: string };

/** The tab's data: the newest sign-ins, and whether older ones exist past the page. */
export type SignInsView =
  | { readonly state: "ready"; readonly entries: readonly SignInView[]; readonly more: boolean }
  | { readonly state: "failed" };

const AGO = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
/** Each unit and how many seconds it holds, largest first. */
const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** How long ago `at` was, from `now` ("3 hours ago", "yesterday"); "just now" under a minute. */
export function howLongAgo(at: string, now: Date): string {
  const seconds = (now.getTime() - new Date(at).getTime()) / 1000;
  const found = UNITS.find(([, size]) => seconds >= size);
  if (found === undefined) return "just now";
  const [unit, size] = found;
  return AGO.format(-Math.floor(seconds / size), unit);
}
