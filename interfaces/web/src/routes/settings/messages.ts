// English text for the settings pages (P2.13c), as apps/web/src/screens/settings/messages.ts has it until P1.20k
// deletes the React screens. One catalog per feature until the i18n slice (P1.19).

export const SETTINGS = {
  label: "Settings",
  nav: "Settings",
  profile: "Profile",
  account: "Account",
  setUpEyebrow: "Not set up yet",
  setUpTitle: "Set up your profile",
  setUpBody:
    "Your name, bio, picture and sections will be edited here. The editor is not ready yet, and your profile stays private until you publish it.",
  handle: "Handle",
  did: "DID",
  handleUnavailable: "We could not check your handle just now.",
  accountLead: "Your password, your email and deleting your account are on your sign-in server.",
  signOutNote: "Signs this browser out of unset.sh.",
  signOut: "Sign out",
  signOutEverywhereNote: "Signs out every browser, this one too. You will sign in again.",
  signOutEverywhere: "Sign out everywhere",
  privacyNoticeTitle: "Privacy notice",
  privacyNotice: "The privacy notice has changed.",
  accountInterstitial: "You are going to {pdsHost}, our sign-in server; it is the only place you type your password.",
  accountOurs: "Your account on {pdsHost}",
  accountForeign: "your sign-in server ({pdsHost})",
  newTab: "(opens in a new tab)",
} as const;
