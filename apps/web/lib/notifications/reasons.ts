// How each notification reason is shown (P2.27, ADR 0079): its words, its icon and where opening it leads. This table
// is the only place the screens know a reason; the list, the badge, opening and "mark all as read" read it and nothing
// else. Adding a reason adds its row here; interfaces/web notifications.ts holds this table and the domain's REASONS
// to the same keys, so the build fails until both agree. English until the i18n slice (P1.19).

export type ReasonScreen = {
  readonly title: string;
  readonly hint: string;
  /** An icon the Icon component draws; reasons.test.ts holds each to the copied Iconoir data. */
  readonly icon: string;
  /** A path on this site, never a URL a sender chose. */
  readonly href: `/${string}`;
};

export const REASON_SCREENS = {
  sign_in: {
    title: "New sign-in to your account",
    hint: "Not you? Sign out everywhere in Settings.",
    icon: "devices",
    href: "/settings/account",
  },
  privacy_notice: {
    title: "We updated our privacy notice",
    hint: "Read what changed.",
    icon: "info",
    href: "/legal/privacy",
  },
} as const satisfies Record<string, ReasonScreen>;

/** A reason's row, or none for one this build does not know (a row sent by a newer build mid-deploy is not shown). */
export const reasonScreen = (reason: string): ReasonScreen | undefined =>
  Object.hasOwn(REASON_SCREENS, reason) ? REASON_SCREENS[reason as keyof typeof REASON_SCREENS] : undefined;
