// How each notification reason is shown (P2.27, ADR 0079 and 0081): its words, its icon, its kind and where its button
// leads. This table is the only place the screens know a reason; the list, the detail, the badge and dismissing read it
// and nothing else. Adding a reason adds its row here; interfaces/web notifications.ts holds this table and the domain's REASONS
// to the same keys, so the build fails until both agree. English until the i18n slice (P1.19).

export type ReasonScreen = {
  readonly title: string;
  /** One line under the title in the bell. */
  readonly hint: string;
  /** The page's detail: what happened and what to do. */
  readonly body: string;
  /** The small label beside the title on the page's rows. */
  readonly kind: string;
  /** The detail's button, which goes to `href`. */
  readonly action: string;
  /** An icon the Icon component draws; reasons.test.ts holds each to the copied Iconoir data. */
  readonly icon: string;
  /** A path on this site, never a URL a sender chose. */
  readonly href: `/${string}`;
};

export const REASON_SCREENS = {
  sign_in: {
    title: "New sign-in to your account",
    hint: "Not you? Sign out everywhere in Settings.",
    body: "Your account was signed in to from another browser. If it was you, there is nothing to do. If not, sign out everywhere in Settings and change your password with your provider.",
    kind: "Account",
    action: "Review sign-ins",
    icon: "devices",
    href: "/settings/account",
  },
  privacy_notice: {
    title: "We updated our privacy notice",
    hint: "Read what changed.",
    body: "Our privacy notice has a new version. Read what changed; dismissing this counts as having seen it.",
    kind: "Privacy",
    action: "Read the privacy notice",
    icon: "info",
    href: "/legal/privacy",
  },
  invite_mail_failed: {
    title: "An invite request could not be mailed to you",
    hint: "A visitor asked for an invite and the mail failed. Check the mail settings.",
    body: "A visitor asked for an invite, but the mail to you could not be sent, and their address was not kept. Check the invite-request mail settings on the server; this shows at most once a day.",
    kind: "Invites",
    action: "Open invites",
    icon: "warning",
    href: "/invite",
  },
} as const satisfies Record<string, ReasonScreen>;

/** A reason's row, or none for one this build does not know (a row sent by a newer build mid-deploy is not shown). */
export const reasonScreen = (reason: string): ReasonScreen | undefined =>
  Object.hasOwn(REASON_SCREENS, reason) ? REASON_SCREENS[reason as keyof typeof REASON_SCREENS] : undefined;
