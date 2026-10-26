// English text for the link to the sign-in server's account page (P2.08, P2.08b; book phase-2.md `PdsAccountLink`).
// One catalog per feature until the i18n slice (P1.19). `{pdsHost}` is the recorded issuer's host.

export const ACCOUNT_LINK = {
  interstitial: "You are going to {pdsHost}, our sign-in server; it is the only place you type your password.",
  ours: "Your account on {pdsHost}",
  foreign: "your sign-in server ({pdsHost})",
} as const;

/** The profile page and its owner editing (Alex 2026-10-23; Figma page Profile, v4 and v5). */
export const PROFILE = {
  unavailable: "We could not load your profile just now.",
  handleUnavailable: "We could not check your handle just now.",
  verified: "Verified",
  checkItem: { done: "Done", notDone: "Not done" },
  readmeForm: { edit: "Edit README", label: "README", save: "Save", cancel: "Cancel", editing: "Editing your README" },
  details: { location: "Location", website: "Website", did: "DID" },
  copyLink: "Copy link",
  share: "Share profile",
  copied: "Copied",
  copyFailed: "Copy failed",
  fields: {
    displayName: "display name",
    headline: "headline",
    location: "place",
    website: "website",
    readme: "README",
    links: "links",
  },
  add: {
    displayName: "Display name",
    headline: "Add a headline",
    location: "Add a place",
    website: "Add a website",
    readme: "Write your README: double-click here or use the pencil.",
    links: "Add a link",
  },
  edit: "Edit {field}",
  draft: "Draft",
  draftBody: "Your changes are not published yet.",
  revert: "Revert to the published profile",
  undo: "Undo",
  redo: "Redo",
  undoKeys: "Ctrl+Z",
  redoKeys: "Ctrl+Shift+Z",
  viewAs: "View as a visitor",
  publish: "Save",
  saving: "Saving…",
  saved: "Saved to your profile.",
  failed: {
    conflict: "Your profile changed somewhere else since you opened it. Reload to see it, then save again.",
    invalid: "Part of your profile could not be saved. Check the name, the website and the lengths.",
    unavailable: "Your sign-in server is not answering, so nothing was saved. Try again.",
    other: "Your profile could not be saved. Try again.",
  },
} as const;

export const SIGNED_OUT = {
  title: "You are signed out of unset",
  ask: "Also sign out of your atproto account?",
  otherApps: "Apps you allowed stay signed in until you remove them there.",
  noThanks: "No thanks",
} as const;
