// The pages the browser harness visits (P1.26; on the SvelteKit server since P1.20k). English only: no `?lang` and no
// locale cookie (P1.22b adds French). A document route of interfaces/web must be listed here or in NOT_DOCUMENTS
// (pages.test.ts walks the route folders).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where browsers, pa11y and Lighthouse open the two processes (fixtures/servers.ts): a TLS listener in front of each
 * server, at a name that is neither an IP nor loopback, which is what the OAuth client accepts in its metadata
 * (@atproto/oauth-client 0.8.9 dist/types.js clientMetadataSchema: "https: URL must not use a loopback host"), and
 * where every browser stores a Secure __Host- cookie. Nothing resolves HOST: Playwright reaches it through PROXY, a
 * CONNECT proxy that sends every tunnel to 127.0.0.1, and pa11y and Lighthouse map it with Chromium's
 * --host-resolver-rules.
 */
export const HOST = "unset.test";
export const LISTEN = { prod: 8443, test: 8444 } as const;
export const PROXY = "http://127.0.0.1:8440";
/** The servers' own plain listeners, which only the TLS listener and the health probe reach. */
export const INNER = { prod: 8080, test: 8081 } as const;
export const PROD_ORIGIN = `https://${HOST}:${LISTEN.prod}`;
export const TEST_ORIGIN = `https://${HOST}:${LISTEN.test}`;

/** The signed-in members the test server seeds, by where each stands (fixtures/servers.ts MEMBERS). */
export type MemberName = "age" | "terms" | "chat" | "verify" | "account" | "notice";
/** The finished member, whose repo the stand-in PDS holds. */
/** A code of the PDS's shape for /join; nothing ever redeems it. */
export const JOIN_CODE = "pds-test-abcde-fghij";
export const ACCOUNT = { did: `did:plc:${"a".repeat(24)}` } as const;
/** A member the indexer has copied (fixtures/servers.ts seeds it on the production server), shown at /@did. */
export const INDEXED = { did: `did:plc:${"p".repeat(24)}` } as const;
/**
 * The test server writes each member's session cookie here once it listens; the specs read it. Outside test-results,
 * which Playwright empties when a run starts (outputDir).
 */
export const SESSIONS_FILE = join(tmpdir(), "unset-e2e-sessions.json");

/** `__Host-sid=…` for `member`, read when a test runs (the file exists only once the test server is up). */
export function memberCookie(member: MemberName): string {
  const cookies = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as Record<MemberName, string>;
  return cookies[member];
}

export type PageGroup = "app" | "public";

export type PageFixture = {
  /** The path the browser opens. */
  readonly path: string;
  /** The route it matches, as pages.test.ts names route folders. */
  readonly route: string;
  readonly group: PageGroup;
  /** The page runs SvelteKit's client (csr, +page.ts): most app pages; never a public page. */
  readonly expectJs: boolean;
  /** Opened on the test server signed in as this member; without one, on the production server signed out. */
  readonly member?: MemberName;
};

const signedOut = (path: string, group: PageGroup, route = path, expectJs = group === "app"): PageFixture => ({
  path,
  route,
  group,
  expectJs,
});
const signedIn = (path: string, member: MemberName, route = path): PageFixture => ({
  path,
  route,
  group: "app",
  expectJs: true,
  member,
});

/** Documents the production server renders to a visitor with no session. */
export const PAGES: readonly PageFixture[] = [
  signedOut("/", "public"),
  signedOut("/legal/terms", "public", "/legal/:document"),
  signedOut("/legal/privacy", "public", "/legal/:document"),
  signedOut("/legal/domains", "public", "/legal/:document"),
  signedOut(`/@${INDEXED.did}`, "public", "/@:actor"),
  // The sign-in page and the blocked page run no script, as on Hono: nothing on them needs it (lighthouserc.json's
  // zero-script row).
  signedOut("/login", "app", "/login", false),
  signedOut("/signed-out", "app"),
  signedOut("/welcome/blocked", "app", "/welcome/blocked", false),
  // P2.10: the page an invite link opens, with a well-formed code (it never checks or spends it).
  signedOut(`/join?invite=${JOIN_CODE}`, "public", "/join"),
];

/** Documents that need a session, at their real paths on the test server, each as a member who belongs there. */
export const MEMBER_PAGES: readonly PageFixture[] = [
  signedIn("/welcome/age", "age"),
  signedIn("/welcome/terms", "terms"),
  signedIn("/welcome/chat", "chat"),
  signedIn("/verify-email", "verify"),
  signedIn(`/${ACCOUNT.did}`, "account", "/:did"),
  signedIn("/settings/profile", "account"),
  signedIn("/settings/privacy", "account"),
  signedIn("/settings/account", "account"),
  signedIn("/invite", "account"),
  signedIn("/notifications", "account"),
];

/** Every page under test, each once. */
export const ALL_PAGES: readonly PageFixture[] = [...PAGES, ...MEMBER_PAGES];

/** The origin a page is opened on. */
export const originOf = (page: PageFixture): string => (page.member === undefined ? PROD_ORIGIN : TEST_ORIGIN);

/**
 * Document routes that are not pages under test. A new document route in neither list fails pages_cover_routes.
 * Non-document routes (+server.ts) are never pages and need no entry.
 */
export const NOT_DOCUMENTS: readonly { readonly route: string; readonly reason: string }[] = [
  { route: "/login/continue", reason: "sign-in handoff, covered by the web integration tests" },
  { route: "/logout/chat", reason: "Log out's handoff to the chat page, covered by the web integration tests" },
  { route: "/privacy-notice/seen", reason: "the banner's dismiss answer; tested in the web integration tests" },
  { route: "/prefs/theme", reason: "the no-script theme form's answer; the footer form is tested in nojs.spec.ts" },
  { route: "/welcome", reason: "always redirects to the current onboarding step" },
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
 * English, the theme cookie on a cookie cell, and the member's session on a signed-in page. A cookie cell sets the
 * opposite system scheme (colorSchemeOf), so a page that ignored the cookie would render the other theme.
 */
export function requestHeaders(cell: ThemeCell, page?: PageFixture): Record<string, string> {
  const cookies = [
    ...(page?.member === undefined ? [] : [memberCookie(page.member)]),
    ...(cell.kind === "cookie" ? [`__Host-theme=${cell.theme}`] : []),
  ];
  return { "accept-language": "en", ...(cookies.length === 0 ? {} : { cookie: cookies.join("; ") }) };
}

export function colorSchemeOf(cell: ThemeCell): "dark" | "light" {
  if (cell.kind === "system") return cell.colorScheme;
  return cell.theme === "dark" ? "light" : "dark";
}

export type KitRoute = { readonly route: string; readonly document: boolean; readonly group?: string };

const ROUTES = join(import.meta.dirname, "../../interfaces/web/src/routes");

/**
 * A route folder name as a path segment: `[did]` → `:did`, `[document=legal]` → `:document`, `@[actor]` → `@:actor`,
 * `[x+2e]` → `.`.
 */
function segment(name: string): string {
  const decoded = name.replace(/\[x\+([0-9a-f]{2})\]/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return decoded.replace(/\[([a-z]+)(=[a-z]+)?\]$/, ":$1");
}

/** interfaces/web's routes, read from its route folders: a +page.svelte is a document, a +server.ts is not. */
export function kitRoutes(dir = ROUTES, prefix = ""): KitRoute[] {
  const routes: KitRoute[] = [];
  const document = existsSync(join(dir, "+page.svelte"));
  if (document || existsSync(join(dir, "+server.ts"))) {
    const policy = join(dir, "policy.ts");
    const group = existsSync(policy) ? /group: "([a-z]+)"/.exec(readFileSync(policy, "utf8"))?.[1] : undefined;
    routes.push({ route: prefix === "" ? "/" : prefix, document, ...(group === undefined ? {} : { group }) });
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) routes.push(...kitRoutes(join(dir, entry.name), `${prefix}/${segment(entry.name)}`));
  }
  return routes;
}

/** Document routes the harness neither visits nor explains. The test-only routes are never documents under test. */
export function uncovered(routes: readonly KitRoute[]): string[] {
  const listed = new Set([...ALL_PAGES.map((page) => page.route), ...NOT_DOCUMENTS.map((entry) => entry.route)]);
  return routes
    .filter((entry) => entry.document && !entry.route.startsWith("/test-routes") && !listed.has(entry.route))
    .map((entry) => entry.route);
}

/** Pages whose route is not a document route of the server. */
export function missingFromRouter(routes: readonly KitRoute[]): string[] {
  const documents = new Set(routes.filter((entry) => entry.document).map((entry) => entry.route));
  return ALL_PAGES.filter((page) => !documents.has(page.route)).map((page) => page.path);
}
