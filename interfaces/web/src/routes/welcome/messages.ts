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
  chatTitle: "Set up your messages",
  chatLead:
    "Messages on unset are end-to-end encrypted: only you and the people you write to can read them. Setting up " +
    "takes a minute on unset.cc, our messages site. You get a recovery key to save: it is the only way to read your " +
    "messages in a new browser. Then you come back here to finish.",
  chatSetUp: "Set up messages",
  chatWaitTitle: "Your messages are getting ready",
  chatWaitLead: "This takes a moment for a new account. Try again in a minute.",
  chatTryAgain: "Try again",
  chatDoneTitle: "Your messages are set up",
  chatDoneLead: "Your recovery key is saved. Continue to finish signing up.",
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
