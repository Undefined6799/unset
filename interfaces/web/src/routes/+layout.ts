// The root layout's load (P1.20d): the `?error=` code a redirect carried, only when it is a catalog code
// (readErrorParam), so no request text reaches the page, and the server load's session flag and theme form (P1.20k).
// No script by default: a page that runs SvelteKit's client (group "app") says `export const csr = true` in its +page.ts; every other page, the error page for an unmatched
// path included, ships none (kit docs, page options: https://svelte.dev/docs/kit/page-options#csr, kit 3.2.0).

import type { Load } from "@sveltejs/kit";
import { readErrorParam } from "@unset/shared-errors";
import type { ShellData } from "../lib/shell.ts";

export const csr = false;

export const load: Load = ({ url, data }) => {
  const server = data as {
    signedIn?: boolean;
    appOpen?: boolean;
    account?: ShellData["account"];
    prefs?: ShellData["prefs"];
    signInHref?: string;
  } | null;
  return {
    signedIn: server?.signedIn === true,
    appOpen: server?.appOpen === true,
    account: server?.account,
    prefs: server?.prefs,
    signInHref: server?.signInHref ?? "/login",
    error: readErrorParam(url.searchParams),
  };
};
