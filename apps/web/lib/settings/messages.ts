// English text for the settings pages (P2.13c), moved beside the settings components that show it. The React copy in
// apps/web/src/screens/settings/messages.ts went with P1.20k. One catalog per feature until the i18n slice (P1.19).

export const SETTINGS = {
  label: "Settings",
  nav: "Settings",
  profile: "Profile",
  privacy: "Privacy",
  account: "Account",
  handle: "Handle",
  did: "DID",
  handleUnavailable: "We could not check your handle just now.",
  accountLead: "Your password, your email and deleting your account are on your sign-in server.",
  signOutNote: "Signs this browser out of unset.sh.",
  signOut: "Sign out",
  signOutEverywhereNote: "Signs out every browser, this one too. You will sign in again.",
  signOutEverywhere: "Sign out everywhere",
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
  cardsNote: "Your text, links and other cards are edited on your page.",
  viewPage: "View your page",
  save: "Save profile",
  saving: "Saving…",
  saved: "Profile saved.",
  refused: "Your profile could not be saved. Try again.",
  /** A refusal shown under the field it blames; the limit is the one the hint gives. */
  tooLong: (n: number) => `This is too long: up to ${n} characters. Shorten it and save again.`,
  fieldError: {
    "profile.url_invalid": "Use an http or https address, such as https://example.com.",
    "profile.name_required": "Add a name before you save.",
    "profile.invalid": "This could not be read. Use one line and save again.",
  } as Readonly<Record<string, string>>,
  unavailableTitle: "Your profile could not be loaded",
  unavailable: "Your sign-in server did not answer just now. Reload the page to try again.",
} as const;

/** Settings › Privacy › Search and AI (ADR 0062; review plan 2026-11-18 §7.2): each switch says what it does and what
 * it cannot do. */
export const SEARCH_AI_SETTINGS = {
  title: "Search and AI",
  lead: "Who may find your public page. Both are off until you turn them on.",
  siteOffTitle: "Search and AI listing is switched off on this site",
  siteOff:
    "No page here is listed by search engines or AI search, whatever you choose below. Your choices are kept, and they apply if listing is switched on.",
  searchEngines: "Search engines may list my page",
  searchEnginesHint:
    "Google, Bing and others may show your page in results, and it joins our sitemap. Search engines decide what to show, and after you turn this off it can take days to leave their results.",
  aiSearch: "AI search may show my page",
  aiSearchHint:
    "The AI search crawlers of ChatGPT, Perplexity, Claude, Meta AI and Amazon may then show your page. It takes about a day to apply. Your page's address is then listed in our public robots.txt file. When someone pastes your link into an AI tool, it reads the page anyway.",
  training:
    "AI training is blocked for the whole site: our robots.txt asks every training crawler whose maker publishes its name (OpenAI, Anthropic, Google, Apple, Meta, Amazon, Common Crawl and Ai2) not to read any page. That is a request, not a lock: a crawler that ignores robots.txt, or whose name we do not know, can still read public pages.",
  searchTitle: "Search title",
  searchTitleHint: (n: number) => `Optional. Replaces your name as the title in results. Up to ${n} characters.`,
  searchDescription: "Search description",
  searchDescriptionHint: (n: number) =>
    `Optional. Replaces your headline under the title. Up to ${n} characters. Search engines may rewrite both.`,
  advanced: "Advanced: search title, description and preview",
  preview: "Search result preview",
  previewNote:
    "An example drawn by unset.sh from what you set here, not taken from a search engine. Search engines choose what to show and may shorten or rewrite it. Your profile picture appears here once pictures arrive on unset.sh.",
  previewUnlisted:
    'With "Search engines may list my page" off, saving asks search engines not to list your page. One that already lists it can take days to drop it.',
  save: "Save search and AI",
  saved: "Search and AI saved.",
} as const;
