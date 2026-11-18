// The theme preference on the page (P1.22; plan §5.1, §5.4), as interfaces/http/prefs/theme.ts applies it: by the
// server, never by a pre-paint script. Only `app` pages read the `__Host-theme` cookie (they are private and vary on
// Cookie, hooks.server.ts); public pages never read it, so a shared cache stays valid. Only enum values reach the
// HTML: a cookie that is absent, repeated or not dark or light means "system", with no error, no echo and no log.
// The placeholders sit in src/app.html; SvelteKit's transformPageChunk fills them (https://svelte.dev/docs/kit/hooks,
// `resolve` options, kit 3.2.0).
// The theme form's write path is here too (P1.20g, from interfaces/http/prefs/theme.ts and prefs/return-to.ts): its
// return target keeps its rules, safeReturnPath for any page and the two sign-in pages with only a checked `next` and
// `handle` rebuilt, never copied.
import type { Cookies } from "@sveltejs/kit";
import { parseDid, parseHandle } from "@unset/domains-identity";
import { safeReturnPath } from "@unset/shared-http";
import type { PageGroup } from "./policy.ts";
import { cookieValue } from "./sign-in-state.ts";

export const THEME_COOKIE = "__Host-theme";
const ONE_YEAR_S = 31_536_000;
const ATTRIBUTES = { path: "/", secure: true, httpOnly: true, sameSite: "lax" } as const;
const SIGN_IN_PATHS: ReadonlySet<string> = new Set(["/login", "/login/continue"]);
const HOME = "/";

/** The one value of `name`, or null when it is missing or repeated. */
export function single(params: URLSearchParams | FormData, name: string): string | null {
  const values = params.getAll(name);
  const [only] = values;
  return values.length === 1 && typeof only === "string" ? only : null;
}

/** The write path's allowlist: the form value, or null for anything else. */
export function parseTheme(value: unknown): ThemePref | null {
  return value === "dark" || value === "light" || value === "system" ? value : null;
}

/** Writes the choice; "system" deletes the cookie, so the default carries no cookie at all. */
export function setThemeCookie(cookies: Cookies, pref: ThemePref): void {
  if (pref === "system") cookies.delete(THEME_COOKIE, ATTRIBUTES);
  else cookies.set(THEME_COOKIE, pref, { ...ATTRIBUTES, maxAge: ONE_YEAR_S });
}

/** A handle as parseHandle normalises it, or a DID as written (DIDs are case-sensitive); null for anything else. */
function checkedHandle(raw: string | null): string | null {
  if (raw === null) return null;
  return parseDid(raw) ?? parseHandle(raw);
}

/** A sign-in page with only its checked `next` and `handle`, or home for any other /login-prefixed target. */
function signInReturn(target: string): string {
  if (target.includes("#")) return HOME;
  const mark = target.indexOf("?");
  const path = mark === -1 ? target : target.slice(0, mark);
  if (!SIGN_IN_PATHS.has(path)) return HOME;
  const query = new URLSearchParams(mark === -1 ? "" : target.slice(mark + 1));
  const rebuilt = new URLSearchParams();
  const next = safeReturnPath(single(query, "next"));
  if (next !== null) rebuilt.set("next", next);
  const handle = checkedHandle(single(query, "handle"));
  if (handle !== null) rebuilt.set("handle", handle);
  return rebuilt.size === 0 ? path : `${path}?${rebuilt}`;
}

/** The form's return target: a sign-in page as above, otherwise safeReturnPath's answer, or home when that is missing
 * or /login-prefixed. */
export function themeReturnTo(target: string | null): string {
  if (target === null) return HOME;
  if (target.toLowerCase().startsWith("/login")) return signInReturn(target);
  // safeReturnPath resolves dot segments, so /./loginx comes back as /loginx: check its answer too.
  const safe = safeReturnPath(target);
  return safe === null || safe.toLowerCase().startsWith("/login") ? HOME : safe;
}

export type ThemePref = "dark" | "light" | "system";

function themeOf(group: PageGroup, header: string | null): ThemePref {
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

/** The page's choice for an app page: what themeChunk applies, for the settings form's checked option. */
export const themeFromCookies = (header: string | null): ThemePref => themeOf("app", header);
