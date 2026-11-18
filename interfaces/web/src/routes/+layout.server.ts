// The root layout's server load (P1.20k): what the shell needs on a page that does not pass it, which is every page
// for the theme form and the error page for the session (+error.svelte gets only layout data). It adds no session or
// cookie read on a public route: locals.did is what the gate (hooks.server.ts) already read for this route's policy,
// none on a public route, and the theme form is on app pages only, as interfaces/http/web/page.ts had it (the theme
// follows the system on public pages, so a choice there would change nothing and their bytes stay the same for all).
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
  const prefs: ShellData["prefs"] =
    policyOf(route.id)?.group === "app"
      ? {
          theme: themeFromCookies(request.headers.get("cookie")),
          returnTo: themeReturnTo(SIGN_IN_PATHS.has(url.pathname) ? url.pathname + url.search : url.pathname),
        }
      : undefined;
  return { signedIn: locals.did !== undefined, prefs, signInHref: signInHref(url.pathname) };
};
