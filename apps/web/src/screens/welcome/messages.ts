// English text for onboarding (P2.12). One catalog per feature until the i18n slice. The age screen's strings are
// scanned for a threshold: none of them may name it.

export const WELCOME = {
  ageTitle: "When were you born?",
  day: "Day",
  month: "Month",
  year: "Year",
  continue: "Continue",
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
  privacyNoticeTitle: "Privacy notice",
  privacyNotice: "The privacy notice has changed.",
} as const;
