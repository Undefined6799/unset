// The Invite page's English text (book P2.10), until the i18n slice (P1.19).
export const INVITE = {
  title: "Invite someone",
  lead: "Each invite is a code for one new account on unset. Send the link to the person you invite; it works once.",
  left: (n: number): string =>
    n === 1 ? "1 invite left in the next 24 hours." : `${n} invites left in the next 24 hours.`,
  country: "The person I invite does not live in the EU, the UK or Australia",
  create: "Create an invite",
  yours: "Your invites from the last 30 days",
  none: "You have no invites from the last 30 days.",
  linkLabel: "Invite link",
  unavailable: "This invite can no longer be shown.",
  hide: "Hide",
  hideLabel: "Hide this invite",
} as const;
