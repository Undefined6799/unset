// The root layout's server load (P1.20k): what the shell needs on a page that does not pass it, which is every page
// for the theme form and the error page for the session (+error.svelte gets only layout data). It adds no session or
// cookie read of its own: locals.did is what the gate (hooks.server.ts) already read for this route's policy, none on a
// public route unless its session is `optional` (home, legal). The theme form and the member's own profile link are
// on app pages and on pages rendered for a member, which the gate sends private and uncached; a visitor's public page
// follows the system theme, so its bytes stay the same for every visitor.
import type { ServerLoad } from "@sveltejs/kit";
import { safeReturnPath } from "@unset/shared-http";
import { policyOf } from "../lib/server/route-table.ts";
import { themeFromCookies, themeReturnTo } from "../lib/server/theme.ts";
import type { ShellData } from "../lib/shell.ts";

/** The sign-in pages keep their checked `next` and `handle` in the return path (themeReturnTo rebuilds them). */
const SIGN_IN_PATHS = new Set(["/login", "/login/continue"]);

/**
 * The shell's Sign in link: back to this page once signed in, as the Hono dialog's `next` was
 * (interfaces/http/web/page.ts), except from home, which is where a sign-in lands anyway, and from the sign-in and
 * signed-out pages, where coming back would only offer Sign in again.
 */
function signInHref(path: string): string {
  if (path === "/" || path === "/signed-out" || SIGN_IN_PATHS.has(path)) return "/login";
  const next = safeReturnPath(path);
  return next === null ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

export const load: ServerLoad = ({ locals, request, route, url }) => {
  const member = locals.did !== undefined;
  const prefs: ShellData["prefs"] =
    policyOf(route.id)?.group === "app" || member
      ? {
          theme: themeFromCookies(request.headers.get("cookie")),
          returnTo: themeReturnTo(SIGN_IN_PATHS.has(url.pathname) ? url.pathname + url.search : url.pathname),
        }
      : undefined;
  const account: ShellData["account"] = member ? { path: `/${locals.did}` } : undefined;
  return { signedIn: member, account, prefs, signInHref: signInHref(url.pathname) };
};
