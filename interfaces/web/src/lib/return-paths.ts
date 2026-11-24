// Where the shell's Sign in link and its theme form send the browser back to, worked out from the page's own address
// where they are drawn (ADR 0116 point 6). The root layout's universal load calls these, on the server for the HTML
// and again in the browser, so neither value is in the data SvelteKit writes into a page's start-up script: that
// script is hashed by the server, so the Content-Security-Policy cannot check what is in it, and on the error page
// the address is whatever a link's author chose.
// Nothing here is a check. /login reads `next` through safeReturnPath, and /prefs/theme reads `return` through
// themeReturnTo (lib/server/theme.ts), each on the server before it sends the browser anywhere; a value they refuse
// lands on the sign-in page with no way back, or on home.

/** The sign-in pages keep their `next` and `handle` in the theme form's way back (themeReturnTo rebuilds them). */
const SIGN_IN_PATHS: ReadonlySet<string> = new Set(["/login", "/login/continue"]);

/**
 * safeReturnPath's own limit (shared/http/returnPath.ts MAX_LENGTH): it refuses anything longer, and the theme form's
 * body must fit /prefs/theme's 2 KB, so a longer address is not sent at all.
 */
const MAX_LENGTH = 512;

/**
 * The shell's Sign in link: back to this page once signed in, except from home, which is where a sign-in lands
 * anyway, and from the sign-in and signed-out pages, where coming back would only offer Sign in again.
 */
export function signInHref(path: string): string {
  if (path === "/" || path === "/signed-out" || SIGN_IN_PATHS.has(path) || path.length > MAX_LENGTH) return "/login";
  return `/login?next=${encodeURIComponent(path)}`;
}

/** The theme form's `return`: this page, with its query on a sign-in page; the path alone, or home, when too long. */
export function themeReturn(url: Pick<URL, "pathname" | "search">): string {
  const withQuery = SIGN_IN_PATHS.has(url.pathname) ? url.pathname + url.search : url.pathname;
  return [withQuery, url.pathname].find((address) => address.length <= MAX_LENGTH) ?? "/";
}
