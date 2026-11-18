// The theme preference (P1.22; plan section 5.1): applied by the server, never by a pre-paint script. Only enum values
// ever reach the HTML or the cookie. Ported from interfaces/http/prefs/theme.ts and prefs/return-to.ts (P1.20g); the
// return target keeps its rules: safeReturnPath for any page, and the two sign-in pages with only a checked `next` and
// `handle` rebuilt, never copied.
import type { Cookies } from "@sveltejs/kit";
import { parseDid, parseHandle } from "@unset/domains-identity";
import { safeReturnPath } from "@unset/shared-http";

export type ThemePref = "dark" | "light" | "system";

/** Host-only by the `__Host-` prefix: Secure, Path=/ and no Domain (RFC 6265bis section 4.1.3.2). */
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
