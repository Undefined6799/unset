// The pages the browser harness visits (P1.26). English only: no `?lang` and no locale cookie.
// P1.22b adds French. A GET in the web route manifest must be listed here or in NOT_DOCUMENTS.

/** Where Playwright, pa11y and Lighthouse open the production process. */
export const PROD_ORIGIN = "http://127.0.0.1:8080";
export const TEST_ORIGIN = "http://127.0.0.1:8081";
/**
 * `PUBLIC_ORIGIN` for that process. @atproto/oauth-client 0.8.9
 * (`dist/types.js`, `oauthClientIdDiscoverableSchema`) rejects a client id that is
 * `http:` or an IP, and the product id is `${PUBLIC_ORIGIN}/oauth-client-metadata.json`
 * (`infrastructure/pds/oauth/oauth-client.ts`). The port matches `PROD_ORIGIN` so the host
 * check strips `:8080` (`shared/http/server.ts` `requestHost`).
 */
export const PROD_PUBLIC_ORIGIN = "https://unset.test:8080";

/**
 * Fixture paths on the test server only. The kit's path template rejects a leading underscore
 * (shared/http/routes.ts SEGMENT), and P1.25 did not ship TEST_ROUTES, so these are not `__test`.
 */
export const FIXTURES = {
  app: "/fixture/app",
  showcase: "/fixture/showcase",
  unlabeled: "/fixture/unlabeled",
  inline: "/fixture/inline",
  script: "/fixture/script",
  welcomeAge: "/fixture/welcome-age",
  welcomeTerms: "/fixture/welcome-terms",
  welcomeChat: "/fixture/welcome-chat",
  account: "/fixture/account",
  settingsProfile: "/fixture/settings-profile",
  settingsAccount: "/fixture/settings-account",
} as const;

export type PageGroup = "app" | "public";

export type PageFixture = {
  readonly path: string;
  readonly group: PageGroup;
  /** The page is written to run without script. */
  readonly zeroJs: boolean;
  /** The browser must observe no script request. */
  readonly expectJs: boolean;
};

/** Documents the production server renders. Redirects and protocol routes stay in NOT_DOCUMENTS. */
export const PAGES: readonly PageFixture[] = [
  { path: "/", group: "public", zeroJs: true, expectJs: false },
  { path: "/legal/terms", group: "public", zeroJs: true, expectJs: false },
  { path: "/legal/privacy", group: "public", zeroJs: true, expectJs: false },
  { path: "/legal/domains", group: "public", zeroJs: true, expectJs: false },
  // P2.05m: the sign-in dialog alone, with no shell and islands off, so no script is requested.
  { path: "/login", group: "app", zeroJs: true, expectJs: false },
  // P2.13 renders this inside the app shell. The header island is a script; the page still works without it.
  { path: "/signed-out", group: "app", zeroJs: false, expectJs: true },
  // P2.12 renders this with islands off and no session. The header stays static, so no script is requested.
  { path: "/welcome/blocked", group: "app", zeroJs: true, expectJs: false },
];

/**
 * The welcome screens that need a signed-in account at their real paths (P2.12a), rendered on the test server as the
 * routes render them: islands off, the app shell, noindex. `/welcome/blocked` needs no session and is in PAGES.
 */
export const WELCOME_FIXTURES: readonly PageFixture[] = [
  { path: FIXTURES.welcomeAge, group: "app", zeroJs: true, expectJs: false },
  { path: FIXTURES.welcomeTerms, group: "app", zeroJs: true, expectJs: false },
  { path: FIXTURES.welcomeChat, group: "app", zeroJs: true, expectJs: false },
  // P2.13c: the account page and the settings pages, as their routes render them with a session.
  { path: FIXTURES.account, group: "app", zeroJs: true, expectJs: false },
  { path: FIXTURES.settingsProfile, group: "app", zeroJs: true, expectJs: false },
  { path: FIXTURES.settingsAccount, group: "app", zeroJs: true, expectJs: false },
];

/**
 * GET routes that are not documents under test. A new GET that is in neither list fails
 * pages_cover_routes. `/login/continue` is the sign-in handoff (P2.13a), not this harness.
 */
export const NOT_DOCUMENTS: readonly { readonly path: string; readonly reason: string }[] = [
  { path: "/health", reason: "readiness probe" },
  { path: "/.well-known/security.txt", reason: "RFC 9116 text, not a document" },
  { path: "/assets/:file", reason: "built file, not a document" },
  { path: "/oauth-client-metadata.json", reason: "OAuth metadata JSON" },
  { path: "/oauth/jwks.json", reason: "OAuth key set JSON" },
  { path: "/oauth/callback", reason: "protocol callback; a browser visit would call the PDS" },
  { path: "/login/continue", reason: "sign-in handoff, covered by P2.13a, not this harness" },
  { path: "/verify-email", reason: "redirects to sign-in without a session" },
  { path: "/did", reason: "resolves the signed-in account; redirects to sign-in without a session" },
  { path: "/:did", reason: "owner-only account; a valid DID redirects to sign-in without a session" },
  { path: "/me", reason: "redirects to sign-in without a session" },
  { path: "/welcome", reason: "always redirects to the current onboarding step" },
  { path: "/welcome/age", reason: "redirects to sign-in without a session" },
  { path: "/welcome/terms", reason: "redirects to sign-in without a session" },
  { path: "/welcome/chat", reason: "redirects to sign-in without a session" },
  { path: "/settings", reason: "always redirects to /settings/profile" },
  { path: "/settings/profile", reason: "redirects to sign-in without a session" },
  { path: "/settings/account", reason: "redirects to sign-in without a session" },
];

export type ThemeCell =
  | { readonly kind: "cookie"; readonly theme: "dark" | "light" }
  | { readonly kind: "system"; readonly colorScheme: "dark" | "light" };

/** App pages vary on the theme cookie. Public pages follow the system scheme and ignore cookies. */
export function themeCells(page: PageFixture): readonly ThemeCell[] {
  if (page.group === "app") {
    return [
      { kind: "cookie", theme: "dark" },
      { kind: "cookie", theme: "light" },
      { kind: "system", colorScheme: "dark" },
      { kind: "system", colorScheme: "light" },
    ];
  }
  return [
    { kind: "system", colorScheme: "dark" },
    { kind: "system", colorScheme: "light" },
  ];
}

export function cellName(cell: ThemeCell): string {
  return cell.kind === "cookie" ? `cookie-${cell.theme}` : `system-${cell.colorScheme}`;
}

/**
 * The opposite system scheme on a cookie cell, so a page that ignored the cookie would render the
 * other theme. Locale is English only: Accept-Language en, never a locale cookie.
 */
export function requestHeaders(cell: ThemeCell): Record<string, string> {
  const headers: Record<string, string> = { "accept-language": "en" };
  if (cell.kind === "cookie") headers.cookie = `__Host-theme=${cell.theme}`;
  return headers;
}

export function colorSchemeOf(cell: ThemeCell): "dark" | "light" {
  if (cell.kind === "system") return cell.colorScheme;
  return cell.theme === "dark" ? "light" : "dark";
}

export type ManifestRoute = { readonly method: string; readonly path: string; readonly group?: string };

/** GET routes in the manifest that this harness neither visits nor explains. */
export function uncovered(routes: readonly ManifestRoute[]): string[] {
  const pages = new Set(PAGES.map((page) => page.path));
  const skipped = new Set(NOT_DOCUMENTS.map((entry) => entry.path));
  return routes
    .filter((route) => route.method === "GET" && !pages.has(route.path) && !skipped.has(route.path))
    .map((route) => route.path);
}

/** Fixture paths that the production manifest does not serve. */
export function missingFromRouter(routes: readonly ManifestRoute[]): string[] {
  const gets = new Set(routes.filter((route) => route.method === "GET").map((route) => route.path));
  return PAGES.filter((page) => !gets.has(page.path)).map((page) => page.path);
}
