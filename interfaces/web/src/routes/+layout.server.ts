// The root layout's server load (P1.20k): what the shell needs on a page that does not pass it, which is every page
// for the theme form and the error page for the session (+error.svelte gets only layout data). It adds no session or
// cookie read of its own: locals.did is what the gate (hooks.server.ts) already read for this route's policy, none on a
// public route unless its session is `optional` (home, legal), and the account button's handle is the verifier's
// cached verdict, never a check (account.ts shellAccount; staging walkthrough 2026-11-19). The theme form and
// the member's own profile link are on app pages and on pages rendered for a member, which the gate sends private and
// uncached; a visitor's public page follows the system theme, so its bytes stay the same for every visitor.
import type { ServerLoad } from "@sveltejs/kit";
import { shellAccount } from "../lib/server/account.ts";
import { type AppOpenDeps, appOpen } from "../lib/server/app-open.ts";
import { services } from "../lib/server/compose.ts";
import { bellView } from "../lib/server/notifications.ts";
import { runsClient } from "../lib/server/policy.ts";
import { policyOf } from "../lib/server/route-table.ts";
import { config } from "../lib/server/runtime.ts";
import { themeFromCookies } from "../lib/server/theme.ts";
import type { ShellData } from "../lib/shell.ts";

function appOpenDeps(): AppOpenDeps {
  const { accounts, versions, log } = services();
  return { readAccount: (did, deadline) => accounts.get(did, deadline), versions, log };
}

export const load: ServerLoad = async (event) => {
  const { locals, request, route, url } = event;
  // Read, and not used: SvelteKit runs a server load again when the part of `url` it read changes (kit docs, "Rerunning
  // load functions": https://svelte.dev/docs/kit/load#Rerunning-load-functions), so this one keeps running on every
  // navigation, as it did while it worked out the return paths, and the bell, the session flag and the changed privacy
  // notice stay current when only the address changes. Nothing of the address is returned (ADR 0116 point 6).
  void url.pathname;
  const member = locals.did !== undefined;
  // The theme the form shows as chosen; where the form returns to is the universal load's to say (+layout.ts).
  const theme = policyOf(route.id)?.group === "app" || member ? themeFromCookies(request.headers.get("cookie")) : null;
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
  // so it is current with no script, no polling and no statement of its own. Undefined for a visitor. The server
  // draws the bell as a link to /notifications on every page, and the client opens the panel wherever it runs (ADR
  // 0116 points 8 and 9), so the entries go only to a route whose page runs the client; an address no route matches
  // is one (its page is the error page). A route that says `client: false` gets the count alone, its own error page
  // too: this load cannot know that the page's load will fail, and there the bell stays the link.
  const notifications = locals.did === undefined ? undefined : await bellView(event, runsClient(policyOf(route.id)));
  // Search and AI listing off on the whole site (P1.21b): every page's markup says noindex, as server.ts's header does.
  const siteNoindex = config.SEARCH_LISTING !== "on";
  return {
    signedIn: member,
    account,
    appOpen: open,
    theme,
    privacyNotice,
    notifications,
    siteNoindex,
  };
};
