// The root layout's server load (P1.20k): what the shell needs on a page that does not pass it, which is every page
// for the theme form and the error page for the session (+error.svelte gets only layout data). It adds no session or
// cookie read of its own: locals.did is what the gate (hooks.server.ts) already read for this route's policy, none on a
// public route unless its session is `optional` (home, legal), and the account button's handle is the verifier's
// cached verdict, never a check (account.ts shellAccount; staging walkthrough 2026-11-19). The theme form and
// the member's own profile link are on app pages and on pages rendered for a member, which the gate sends private and
// uncached; a visitor's public page follows the system theme, so its bytes stay the same for every visitor.
import type { ServerLoad } from "@sveltejs/kit";
import { safeReturnPath } from "@unset/shared-http";
import { shellAccount } from "../lib/server/account.ts";
import { type AppOpenDeps, appOpen } from "../lib/server/app-open.ts";
import { services } from "../lib/server/compose.ts";
import { bellView } from "../lib/server/notifications.ts";
import { policyOf } from "../lib/server/route-table.ts";
import { config } from "../lib/server/runtime.ts";
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

function appOpenDeps(): AppOpenDeps {
  const { accounts, versions, log } = services();
  return { readAccount: (did, deadline) => accounts.get(did, deadline), versions, log };
}

export const load: ServerLoad = async (event) => {
  const { locals, request, route, url } = event;
  const member = locals.did !== undefined;
  const prefs: ShellData["prefs"] =
    policyOf(route.id)?.group === "app" || member
      ? {
          theme: themeFromCookies(request.headers.get("cookie")),
          returnTo: themeReturnTo(SIGN_IN_PATHS.has(url.pathname) ? url.pathname + url.search : url.pathname),
        }
      : undefined;
  const account: ShellData["account"] = locals.did === undefined ? undefined : shellAccount(services(), locals.did);
  // Whether an error page may offer the app's menus (app-open.ts); a path no route matches has no policy row.
  const open =
    locals.did === undefined
      ? false
      : await appOpen(
          appOpenDeps(),
          locals.did,
          route.id === null ? null : (policyOf(route.id) ?? null),
          locals.deadline,
        );
  // The changed privacy notice banner (P2.12b), as the app gate decided it for this request; it names the version it
  // shows so its dismiss records that one and no newer.
  const privacyNotice = locals.privacyNotice ? services().versions.privacy : null;
  // The bell (P2.27): the newest few and their count, brought by the session read on every page a member opens,
  // so it is current with no script, no polling and no statement of its own. Undefined for a visitor.
  const notifications = locals.did === undefined ? undefined : await bellView(event);
  // Whether the bell opens its panel: only a page that runs script can mark what the panel showed (ADR 0085). Every
  // other page (home, a profile, the legal pages, an error page) draws the bell as a link to /notifications, whose
  // visit marks it (ADR 0108 point 3).
  const bellOpens = route.id !== null && policyOf(route.id)?.group === "app";
  // Search and AI listing off on the whole site (P1.21b): every page's markup says noindex, as server.ts's header does.
  const siteNoindex = config.SEARCH_LISTING !== "on";
  return {
    signedIn: member,
    account,
    appOpen: open,
    prefs,
    privacyNotice,
    notifications,
    bellOpens,
    signInHref: signInHref(url.pathname),
    siteNoindex,
  };
};
