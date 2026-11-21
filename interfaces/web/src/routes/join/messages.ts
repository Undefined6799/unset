// The join page's English text (book P2.10), until the i18n slice (P1.19).
export const JOIN = {
  title: "You're invited to unset",
  lead: "Someone on unset sent you an invite. It is a code for one new account.",
  codeLabel: "Your invite code",
  malformed: "This invite link looks broken. Ask the person who sent it for a new one.",
  noCode: "Open the link from your invite to see your code here.",
  noInvite: "No invite yet?",
  request: "Request an invite",
  next: (host: string): string =>
    `You'll pick your handle and password on ${host}, where you enter this code, then come back here.`,
  country: "Invites are only for people who do not live in the EU, the UK or Australia.",
  create: "Create account",
  signedIn: "You're signed in already, so this invite is for someone else. Send them the link.",
} as const;
