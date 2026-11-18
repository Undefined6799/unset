// What a page tells the shell (routes/+layout.svelte), and the shell's English text (P1.20d). A page's load returns
// `shell` (a ShellData); with none, the page gets the signed-out site shell. Only display state goes here: the shell
// never reads a cookie or a session itself, so a page that passes nothing renders the same bytes for everyone.
// Two shells, as apps/web/src/shell/AppShell.tsx draws them today:
// - "site": skip link, a header with Sign in (none when `signedIn`), main, and a footer of links, plus the theme form
//   when `prefs` is given (app pages only).
// - "core": skip link, a header with the menu button, the menu drawer (a native popover, so it opens with no script),
//   a bottom bar on phones, and main. `account` is the signed-in member's profile link; with it the drawer also offers
//   Sign out, and with `prefs` the theme picker.
// - "bare": main alone, centred (the sign-in page, which Hono drew with no shell).

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
}>;

/** For a page whose bytes depend on no cookie and no session: a browser may keep it five minutes (P1.25v, Alex
 * 2026-11-15), so a changed page can take that long to show. */
export const PUBLIC_PAGE_CACHE = "public, max-age=300";

export const SITE_SHELL: ShellData = { kind: "site" };

export const SHELL_TEXT = {
  skip: "Skip to content",
  brand: "unset.sh",
  homeLabel: "unset.sh home",
  signIn: "Sign in",
  home: "Home",
  profile: "Profile",
  settings: "Settings",
  menu: "Menu",
  closeMenu: "Close menu",
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
