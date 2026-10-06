// The theme preference (P1.22; plan §5.1, §5.4; architecture point 8 of 2026-10-06): applied by the server, never by
// a pre-paint script. Public pages never read the cookie and never vary on it, so a shared cache stays valid; app
// pages read it and are private. Only enum values ever reach the HTML: a cookie that is absent, repeated or not an
// allowed value means "system", with no error, no echo and no log.
import type { RouteGroup } from "@unset/shared-http";

export type ThemePref = "dark" | "light" | "system";
/** The page's `color-scheme` meta: the chosen scheme, or both for system so the canvas follows the OS. */
export type ColorScheme = "dark" | "light" | "dark light";

/** Host-only by the `__Host-` prefix: Secure, Path=/ and no Domain (RFC 6265bis §4.1.3.2). */
export const THEME_COOKIE = "__Host-theme";
const ONE_YEAR_S = 31_536_000;
const ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";

/** The write path's allowlist: the form value, or null for anything else. */
export function parseTheme(value: unknown): ThemePref | null {
  return value === "dark" || value === "light" || value === "system" ? value : null;
}

/** The Set-Cookie value for a choice; "system" deletes the cookie, so the default carries no cookie at all. */
export function themeCookie(pref: ThemePref): string {
  if (pref === "system") return `${THEME_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
  return `${THEME_COOKIE}=${pref}; ${ATTRIBUTES}; Max-Age=${ONE_YEAR_S}`;
}

/** The theme cookie's value when exactly one is sent and it is dark or light; otherwise "system". */
function themeFromCookies(header: string | null): ThemePref {
  const values = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${THEME_COOKIE}=`))
    .map((pair) => pair.slice(THEME_COOKIE.length + 1));
  const [only] = values;
  return values.length === 1 && (only === "dark" || only === "light") ? only : "system";
}

/** The theme for a page in `group` and the request headers its response varies on. */
export function resolvePrefs(group: RouteGroup, cookieHeader: string | null): { theme: ThemePref; vary: string[] } {
  if (group !== "app") return { theme: "system", vary: [] };
  return { theme: themeFromCookies(cookieHeader), vary: ["Cookie"] };
}

export type DocumentPrefs = {
  /** The `<html>` attributes: `lang` (English only until P1.22b) and `data-theme` for an explicit app choice. */
  htmlAttrs: { lang: "en"; "data-theme"?: "dark" | "light" };
  colorScheme: ColorScheme;
  /** Headers the page response carries: app pages vary on Cookie and are private; public pages add none. */
  headers: Record<string, string>;
};

/** What the document renderer (P1.23) writes for a page in `group`, from the request's Cookie header. */
export function documentPrefs(group: RouteGroup, cookieHeader: string | null): DocumentPrefs {
  const { theme, vary } = resolvePrefs(group, cookieHeader);
  return {
    htmlAttrs: theme === "system" ? { lang: "en" } : { lang: "en", "data-theme": theme },
    colorScheme: theme === "system" ? "dark light" : theme,
    headers: vary.length === 0 ? {} : { vary: vary.join(", "), "cache-control": "private, no-store" },
  };
}
