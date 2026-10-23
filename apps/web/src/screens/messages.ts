// English text for the link to the sign-in server's account page (P2.08, P2.08b; book phase-2.md `PdsAccountLink`).
// One catalog per feature until the i18n slice (P1.19). `{pdsHost}` is the recorded issuer's host.

export const ACCOUNT_LINK = {
  interstitial: "You are going to {pdsHost}, our sign-in server; it is the only place you type your password.",
  ours: "Your account on {pdsHost}",
  foreign: "your sign-in server ({pdsHost})",
} as const;

export const SIGNED_OUT = {
  title: "You are signed out of unset",
  ask: "Also sign out of your atproto account?",
  otherApps: "Apps you allowed stay signed in until you remove them there.",
  noThanks: "No thanks",
} as const;
