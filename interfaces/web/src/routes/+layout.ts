// The root layout's load (P1.20d): the `?error=` code a redirect carried, only when it is a catalog code
// (readErrorParam), so no request text reaches the page, and the server load's session flag and theme form (P1.20k)
// and the changed privacy notice banner (P2.12b), the bell's notifications (P2.27), and whether listing is off on the whole site (P1.21b).
// Every page says in its own +page.ts whether it runs SvelteKit's client (`csr`; book P1.22j), so the default here
// decides one thing only, the error page: for a failed load and for a path no route matches SvelteKit takes `csr` from
// the layouts alone (kit 3.2.0 src/runtime/server/page/index.js:272-291, page/respond_with_error.js:44-46). It ships
// no script (kit docs, page options: https://svelte.dev/docs/kit/page-options#csr).

import type { Load } from "@sveltejs/kit";
import type { NotificationsView } from "@unset/apps-web/lib/notifications/view.ts";
import { readErrorParam } from "@unset/shared-errors";
import type { ShellData } from "../lib/shell.ts";

export const csr = false;

export const load: Load = ({ url, data }) => {
  const server = data as {
    signedIn?: boolean;
    appOpen?: boolean;
    account?: ShellData["account"];
    prefs?: ShellData["prefs"];
    privacyNotice?: string | null;
    notifications?: NotificationsView;
    bellOpens?: boolean;
    signInHref?: string;
    siteNoindex?: boolean;
  } | null;
  return {
    signedIn: server?.signedIn === true,
    appOpen: server?.appOpen === true,
    account: server?.account,
    prefs: server?.prefs,
    // The privacy notice version the changed-notice banner names (P2.12b), or null when it does not show.
    privacyNotice: typeof server?.privacyNotice === "string" ? server.privacyNotice : null,
    // The bell's list and count (P2.27); undefined for a visitor.
    notifications: server?.notifications,
    // Whether the bell opens its panel (a page with script) or is a link to /notifications (ADR 0108 point 3).
    bellOpens: server?.bellOpens === true,
    signInHref: server?.signInHref ?? "/login",
    // Search and AI listing off on the whole site (P1.21b); without the server's word, noindex.
    siteNoindex: server?.siteNoindex !== false,
    error: readErrorParam(url.searchParams),
  };
};
