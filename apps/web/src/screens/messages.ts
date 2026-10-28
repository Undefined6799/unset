// English text for the link to the sign-in server's account page (P2.08, P2.08b; book phase-2.md `PdsAccountLink`).
// One catalog per feature until the i18n slice (P1.19). `{pdsHost}` is the recorded issuer's host.

export const ACCOUNT_LINK = {
  interstitial: "You are going to {pdsHost}, our sign-in server; it is the only place you type your password.",
  ours: "Your account on {pdsHost}",
  foreign: "your sign-in server ({pdsHost})",
  newTab: "(opens in a new tab)",
} as const;
