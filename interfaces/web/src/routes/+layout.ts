// The root layout's load (P1.20d): the `?error=` code a redirect carried, only when it is a catalog code
// (readErrorParam), so no request text reaches the page, and the server load's session flag and theme form (P1.20k)
// and the changed privacy notice banner (P2.12b), the bell's notifications (P2.27), and whether listing is off on the whole site (P1.21b).
// Every page says in its own +page.ts whether it runs SvelteKit's client (`csr`; book P1.22j), so the default here
// decides one thing only, the error page: for a failed load and for a path no route matches SvelteKit takes `csr` from
// the layouts alone (kit 3.2.0 src/runtime/server/page/index.js:272-291, page/respond_with_error.js:44-46). It runs
// the client like every other page (ADR 0116 point 1; kit docs, page options:
// https://svelte.dev/docs/kit/page-options#csr); the server still draws it whole, so it reads the same with script off.

import type { Load } from "@sveltejs/kit";
import type { NotificationsView } from "@unset/apps-web/lib/notifications/view.ts";
import { readErrorParam } from "@unset/shared-errors";
import { signInHref, themeReturn } from "../lib/return-paths.ts";
import type { ShellData, ThemeChoice } from "../lib/shell.ts";

export const csr = true;

export const load: Load = ({ url, data }) => {
  const server = data as {
    signedIn?: boolean;
    appOpen?: boolean;
    account?: ShellData["account"];
    theme?: ThemeChoice | null;
    privacyNotice?: string | null;
    notifications?: NotificationsView;
    bellOpens?: boolean;
    siteNoindex?: boolean;
  } | null;
  return {
    signedIn: server?.signedIn === true,
    appOpen: server?.appOpen === true,
    account: server?.account,
    // The theme form, where the server says this page has one (+layout.server.ts), returning to this page.
    prefs: typeof server?.theme === "string" ? { theme: server.theme, returnTo: themeReturn(url) } : undefined,
    // The privacy notice version the changed-notice banner names (P2.12b), or null when it does not show.
    privacyNotice: typeof server?.privacyNotice === "string" ? server.privacyNotice : null,
    // The bell's list and count (P2.27); undefined for a visitor.
    notifications: server?.notifications,
    // Whether the bell opens its panel (a page with script) or is a link to /notifications (ADR 0108 point 3).
    bellOpens: server?.bellOpens === true,
    // The shell's Sign in link, back to this page (lib/return-paths.ts says why it is worked out here).
    signInHref: signInHref(url.pathname),
    // Search and AI listing off on the whole site (P1.21b); without the server's word, noindex.
    siteNoindex: server?.siteNoindex !== false,
    error: readErrorParam(url.searchParams),
  };
};
