// The pages the browser harness visits (P1.26). English only: no `?lang` and no locale cookie.
// P1.22b adds French. A GET in the web route manifest must be listed here or in NOT_DOCUMENTS.

export const PROD_ORIGIN = "http://127.0.0.1:8080";
export const TEST_ORIGIN = "http://127.0.0.1:8081";

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
  { path: "/login", group: "app", zeroJs: true, expectJs: false },
  { path: "/signed-out", group: "app", zeroJs: true, expectJs: false },
];

/**
 * GET routes that are not documents under test. A new GET that is in neither list fails
 * pages_cover_routes. `/login/continue` is the sign-in handoff (P2.13a), not this harness.
 */
export const NOT_DOCUMENTS: readonly { readonly path: string; readonly reason: string }[] = [
  { path: "/health", reason: "readiness probe" },
  { path: "/assets/:file", reason: "built file, not a document" },
  { path: "/oauth-client-metadata.json", reason: "OAuth metadata JSON" },
  { path: "/oauth/jwks.json", reason: "OAuth key set JSON" },
  { path: "/oauth/callback", reason: "protocol callback; a browser visit would call the PDS" },
  { path: "/login/continue", reason: "sign-in handoff, covered by P2.13a, not this harness" },
  { path: "/verify-email", reason: "redirects to sign-in without a session" },
  { path: "/me", reason: "redirects to sign-in without a session" },
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
