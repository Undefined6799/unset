// The shell's English text (P1.25), and that of the pages it brings: the landing placeholder, the legal placeholders
// and the error page. The error codes' own text is shared/errors' (ERROR_MESSAGES). P1.19 turns both into the EN/FR
// catalogs in the i18n slice.

export const SHELL = {
  skip: "Skip to content",
  menu: "menu",
  signIn: "Sign in",
  siteColumn: "unset.sh",
  home: "Home",
  legalColumn: "Legal",
  terms: "Terms",
  privacy: "Privacy",
  note: "© 2026 unset.sh",
} as const;

export const HOME = {
  heading: "unset.sh",
  lead: "An identity and profile app on the AT Protocol. It is not open yet.",
} as const;

export const LEGAL = {
  terms: "Terms of service",
  privacy: "Privacy notice",
  preparing: "This document is in preparation. It will be published here before anyone can sign up.",
} as const;

export const ERROR_PAGE = {
  code: "Error code",
  requestId: "Request id, if you contact us:",
  home: "Go to the home page",
} as const;
