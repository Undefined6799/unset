// The root layout's load (P1.20d): the `?error=` code a redirect carried, only when it is a catalog code
// (readErrorParam), so no request text reaches the page, and the server load's session flag and theme form (P1.20k)
// and the changed privacy notice banner (P2.12b), the bell's notifications (P2.27), the chat icon (build step 10), and whether listing is off on the whole site (P1.21b).
// No script by default: a page that runs SvelteKit's client (group "app") says `export const csr = true` in its +page.ts; every other page, the error page for an unmatched
// path included, ships none (kit docs, page options: https://svelte.dev/docs/kit/page-options#csr, kit 3.2.0).

import type { Load } from "@sveltejs/kit";
import type { NotificationsView } from "@unset/apps-web/lib/notifications/view.ts";
import { readErrorParam } from "@unset/shared-errors";
import type { ChatIcon, ShellData } from "../lib/shell.ts";

export const csr = false;

export const load: Load = ({ url, data }) => {
  const server = data as {
    signedIn?: boolean;
    appOpen?: boolean;
    account?: ShellData["account"];
    prefs?: ShellData["prefs"];
    privacyNotice?: string | null;
    notifications?: NotificationsView;
    chat?: ChatIcon;
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
    // The chat icon's link and number (build step 10); undefined for a visitor.
    chat: server?.chat,
    signInHref: server?.signInHref ?? "/login",
    // Search and AI listing off on the whole site (P1.21b); without the server's word, noindex.
    siteNoindex: server?.siteNoindex !== false,
    error: readErrorParam(url.searchParams),
  };
};
