// The theme preference on the page (P1.22; plan §5.1, §5.4), as interfaces/http/prefs/theme.ts applies it: by the
// server, never by a pre-paint script. Only `app` pages read the `__Host-theme` cookie (they are private and vary on
// Cookie, hooks.server.ts); public pages never read it, so a shared cache stays valid. Only enum values reach the
// HTML: a cookie that is absent, repeated or not dark or light means "system", with no error, no echo and no log.
// The placeholders sit in src/app.html; SvelteKit's transformPageChunk fills them (https://svelte.dev/docs/kit/hooks,
// `resolve` options, kit 3.2.0).
import type { PageGroup } from "./policy.ts";
import { cookieValue } from "./sign-in-state.ts";

export const THEME_COOKIE = "__Host-theme";

type Theme = "dark" | "light" | "system";

function themeOf(group: PageGroup, header: string | null): Theme {
  if (group !== "app") return "system";
  const value = cookieValue(header, THEME_COOKIE);
  return value === "dark" || value === "light" ? value : "system";
}

/** Fills app.html's `%unset.theme%` (the html element's data-theme) and `%unset.scheme%` (the color-scheme meta). */
export function themeChunk(group: PageGroup, header: string | null): (input: { html: string }) => string {
  const theme = themeOf(group, header);
  const attribute = theme === "system" ? "" : ` data-theme="${theme}"`;
  const scheme = theme === "system" ? "dark light" : theme;
  return ({ html }) => html.replace("%unset.theme%", attribute).replace("%unset.scheme%", scheme);
}
