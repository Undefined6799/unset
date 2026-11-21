// English text for onboarding (P2.12), as apps/web/src/screens/welcome/messages.ts had it; that copy went at P1.20k.
// The age screen's strings are scanned for a threshold: none of them may name it.
export const WELCOME = {
  ageTitle: "When were you born?",
  day: "Day",
  month: "Month",
  year: "Year",
  continue: "Continue",
  ageConfirmTitle: "Is this date right?",
  ageConfirmLead: "You entered",
  ageConfirm: "Yes, continue",
  ageChange: "Change the date",
  termsTitle: "Terms and privacy",
  termsLead: "unset.sh is invite-only. The terms and the privacy notice say what joining means.",
  termsLink: "Terms",
  privacyLink: "Privacy notice",
  accept: "I accept the terms and the privacy notice",
  country: "I do not live in the EU, the UK or Australia",
  chatTitle: "Chat comes later",
  chatLead: "Chat is not open yet. You can continue and use unset.sh without it.",
  blockedTitle: "We can't offer you an account right now",
  blockedLead: "If you think this is a mistake, you can ask for a review.",
  appeal: "Ask for a review",
  appealUnpublished: "The review address is not published on this page yet.",
  signOut: "Sign out",
} as const;

export const VERIFY_EMAIL = {
  title: "Confirm your email",
  confirmed: "Your email is confirmed.",
  continue: "Continue",
  openAccount: "Confirm your email in the new tab, then come back here.",
  checkAgain: "I've confirmed it — check again",
  needsConsent: "unset.sh needs permission to see whether your email is confirmed.",
  allow: "Allow email access",
  unavailable: (host: string) => `${host} is not answering; your session is kept.`,
  tryAgain: "Try again",
} as const;

// /allow: a sign-in from before a permission the app now asks for.
export const ALLOW_ACCESS = {
  title: "Allow access",
  why: "unset.sh needs a permission your sign-in has not given it yet, so your change was not saved.",
  kept: "Your unsaved changes stay on this device. Allow access on your sign-in server, then save again.",
  allow: "Allow access",
} as const;
