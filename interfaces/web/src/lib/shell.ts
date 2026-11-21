// What a page tells the shell (routes/+layout.svelte), and the shell's English text (P1.20d). A page's load returns
// `shell` (a ShellData); with none, the page gets the signed-out site shell. Only display state goes here: the shell
// never reads a cookie or a session itself; the only member it shows unasked is the one the gate read (locals.did).
// Three shells, as apps/web/src/shell/AppShell.tsx drew them before P1.20k:
// - "site": skip link, a header with Sign in (none when `signedIn`), main, and a footer of links, plus the theme form
//   when `prefs` is given (app pages only).
// - "core": skip link, the two-row header (Alex, 2026-11-18, "Clean tabs", and the planned menus he sent at 05:04Z):
//   the menu button and wordmark, the action buttons and account control above, the main destinations below; each
//   button opens a panel (a native popover, so it opens with no script); then main, and a footer with the legal links.
//   `account` is the signed-in member: with it the header shows their account menu (profile, settings, the theme
//   picker with `prefs`, Sign out); without it, Sign in. The layout falls back to the member the gate read when a
//   page passes no `account` (home and the legal pages, whose member copies are private).
// - "bare": main alone, centred (the sign-in page, which Hono drew with no shell).

/** The chat icon (build step 10): a plain link to the chat page, and the number of chats with new messages (0: none). */
export type ChatIcon = Readonly<{ href: string; unread: number }>;

export type ThemeChoice = "dark" | "light" | "system";

export type ShellData = Readonly<{
  kind: "site" | "core" | "bare";
  /** The core shell's current destination. */
  active?: "home" | "account" | "settings";
  /** The signed-in member (core shell): their profile path and, when known, the name shown beside it. */
  account?: Readonly<{ path: string; name?: string }>;
  /** The theme form, preset to the page's theme, returning to the page's path (already checked by the page). */
  prefs?: Readonly<{ theme: ThemeChoice; returnTo: string }>;
  /** The page holds a session (site shell): no Sign in anywhere. */
  signedIn?: true;
  /** A page heading only assistive technology reads (home's). */
  hiddenHeading?: string;
  /** Adds <meta name="robots" content="noindex">; the page sets the X-Robots-Tag header itself. */
  noindex?: true;
  /** A full-width main (core shell) for a page with its own frame (the member page, the settings list), with
   * the header's own side padding, so the page lines up under the header's menu button (Alex, 2026-11-18). The page
   * caps its own width. */
  wide?: true;
}>;

/** For a visitor's copy of a page that depends on no cookie and no session: a browser may keep it five minutes (P1.25v,
 * Alex 2026-11-15), so a changed page can take that long to show. A copy rendered for a member is sent private and never
 * stored instead (hooks.server.ts withGroupHeaders). */
export const PUBLIC_PAGE_CACHE = "public, max-age=300";

export const SITE_SHELL: ShellData = { kind: "site" };

/** Every error page (P1.20k): the core shell, kept out of search results, signed in when the gate read a session. */
export const ERROR_SHELL: ShellData = { kind: "core", noindex: true };
/** An error page for a member mid-onboarding: signed in, but none of the app's menus, which would send them back. */
export const STEP_ERROR_SHELL: ShellData = { kind: "site", signedIn: true, noindex: true };

/** The account button's letter, as the React Avatar's avatarLetter drew it before P1.20k: the first character
 * of the name without a leading "@", uppercased; "?" for an empty name. */
export function accountLetter(name: string): string {
  const first = [...name.replace(/^@/, "").trim()][0];
  return first === undefined ? "?" : first.toUpperCase();
}

export const SHELL_TEXT = {
  skip: "Skip to content",
  privacyNoticeTitle: "Privacy notice updated",
  privacyNotice: "Read what changed in our privacy notice.",
  privacyNoticeDismiss: "Dismiss",
  brand: "unset.sh",
  brandName: "unset",
  brandSuffix: ".sh",
  homeLabel: "unset.sh home",
  signIn: "Sign in",
  home: "Home",
  settings: "Settings",
  yourProfile: "Your profile",
  account: "Your account",
  accountMenu: "Account menu",
  appearance: "Appearance",
  mainNav: "Main",
  search: "Search unset.sh",
  create: "Create",
  messages: "Messages",
  /** The chat icon's accessible name with its number of chats with new messages (build step 10). */
  chat: (n: number): string =>
    n === 0 ? "Messages" : `Messages, ${n} ${n === 1 ? "chat" : "chats"} with new messages`,
  notifications: "Notifications",
  community: "Community",
  explore: "Explore",
  moreActions: "More actions",
  comingSoon: "coming soon",
  more: "More on unset.sh",
  menu: "Menu",
  close: "Close",
  saved: "Saved",
  yourCommunities: "Your communities",
  help: "Help",
  newPost: "New post",
  shareLink: "Share a link",
  askQuestion: "Ask a question",
  addCard: "Add a profile card",
  messagesSoon: "Messages are coming soon. Your conversations will appear here.",
  openInbox: "Open inbox",
  searchSoon: "Search is coming soon. You will search unset.sh here.",
  signOut: "Sign out",
  siteColumn: "unset.sh",
  legalColumn: "Legal",
  terms: "Terms",
  privacy: "Privacy",
  domains: "Domains",
  note: "© 2026 unset.sh",
  theme: "Theme",
  dark: "Dark",
  light: "Light",
  system: "System",
  saveTheme: "Save theme",
} as const;
