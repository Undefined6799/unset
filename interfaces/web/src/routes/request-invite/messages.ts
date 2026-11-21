// The invite-request page's English text (book P2.10r; ADR 0080), until the i18n slice (P1.19).
export const REQUEST_INVITE = {
  title: "Request an invite",
  lead: "unset is invite only for now. Leave your email address and the person who runs unset may send you an invite.",
  emailLabel: "Your email address",
  age: (minAge: number): string => `I am ${minAge} or older`,
  country: "I do not live in the EU, the UK or Australia",
  // Says what happens to the address; the privacy notice holds the full text.
  privacy:
    "Your address is emailed to the person who runs unset, through our mail provider Resend in the United States, " +
    "which keeps it for 30 days. unset itself keeps no copy.",
  notice: "Privacy notice",
  send: "Request an invite",
  received: "Thanks, your request is in. If an invite is possible, it comes to that address by email.",
  closed: "unset is invite only, and invite requests are closed for now.",
  signedIn: "You're signed in already. To bring someone in, make an invite on your Invite page.",
  invitePage: "Go to Invite",
  // The hidden field bots fill in; people never see it.
  trapLabel: "Leave this empty",
} as const;
