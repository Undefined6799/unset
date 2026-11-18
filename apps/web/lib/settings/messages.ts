// English text for the settings pages (P2.13c), moved beside the settings components that show it. The React copy in
// apps/web/src/screens/settings/messages.ts went with P1.20k. One catalog per feature until the i18n slice (P1.19).

export const SETTINGS = {
  label: "Settings",
  nav: "Settings",
  profile: "Profile",
  account: "Account",
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
  accountForeign: "Your sign-in server ({pdsHost})",
  newTab: "(opens in a new tab)",
  accountTitle: "Your account",
  accountServerTitle: "Password, email and deletion",
  signOutTitle: "Sign out",
} as const;

/** Settings › Profile: the fields at the top of the member's page, saved by POST /profile. */
export const PROFILE_SETTINGS = {
  lead: "What people see at the top of your page.",
  firstLead: "Add a name to start your page. You can change any of this later.",
  displayName: "Name",
  displayNameHint: (n: number) => `Required. Up to ${n} characters.`,
  headline: "Headline",
  headlineHint: (n: number) => `One line under your name, up to ${n} characters.`,
  location: "Place",
  locationHint: (n: number) => `Where you are, as you want to say it. Up to ${n} characters.`,
  website: "Website",
  websiteHint: "An http or https address.",
  cardsNote: "Your README, links and other cards are edited on your page.",
  viewPage: "View your page",
  save: "Save profile",
  saving: "Saving…",
  saved: "Profile saved.",
  refused: "Your profile could not be saved. Try again.",
  unavailableTitle: "Your profile could not be loaded",
  unavailable: "Your sign-in server did not answer just now. Reload the page to try again.",
} as const;
