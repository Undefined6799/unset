// The shell's English text (P1.25), and that of the pages it brings: the landing placeholder, the legal placeholders
// and the error page. The error codes' own text is shared/errors' (ERROR_MESSAGES). P1.19 turns both into the EN/FR
// catalogs in the i18n slice.

export const SHELL = {
  skip: "Skip to content",
  menu: "menu",
  signIn: "Sign in",
  siteColumn: "unset.sh",
  home: "Home",
  profile: "Profile",
  settings: "Settings",
  coreMenu: "Menu",
  closeMenu: "Close menu",
  close: "Close",
  homeLabel: "unset.sh home",
  signOut: "Sign out",
  legalColumn: "Legal",
  terms: "Terms",
  privacy: "Privacy",
  domains: "Domains",
  note: "© 2026 unset.sh",
} as const;

export const PREFS = {
  theme: "Theme",
  dark: "Dark",
  light: "Light",
  system: "System",
  save: "Save theme",
} as const;

export const HOME = {
  heading: "Home",
} as const;

export const LEGAL = {
  banner: "This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice.",
} as const;

export const ERROR_PAGE = {
  code: "Error code",
  requestId: "Request id, if you contact us:",
  home: "Go to the home page",
} as const;
