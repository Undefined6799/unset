// The door's cookies (ADR 0093 decision 4; CLAUDE.md "Cookies"): host-only `__Host-` cookies on unset.cc, never a
// Domain attribute, always Secure, HttpOnly and Path=/ (RFC 6265bis-22 section 4.1.3.2, read 2026-11-21:
// https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-22). Reading is strict: a name
// sent twice reads as absent, so a planted duplicate can never choose which value the door sees.

/** The one-time value of a sign-in hop, and the path the hop returns to; both live ten minutes and are cleared at redeem. */
export const STATE_COOKIE = "__Host-chat-state";
export const RETURN_COOKIE = "__Host-chat-return";
/** The browser: 32 random bytes the door's browser list knows only by their sha256 (migration 0038). */
export const BROWSER_COOKIE = "__Host-chat-browser";

export const HOP_MAX_AGE_S = 600;
/** 400 days, the longest lifetime a browser keeps (RFC 6265bis-22 section 5.5, "Cookie Lifetime Limits", read
 * 2026-11-21), so an expired chat session finds its device and lock key again (ADR 0095 decision 4). */
export const BROWSER_MAX_AGE_S = 400 * 86_400;

export type SameSite = "Lax" | "Strict";

/** One Set-Cookie value. `value` is already cookie-safe (base64url or percent-encoded); "" with maxAge 0 clears it. */
export function setCookie(name: string, value: string, maxAgeS: number, sameSite: SameSite): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeS}; Secure; HttpOnly; SameSite=${sameSite}`;
}

export const clearCookie = (name: string, sameSite: SameSite) => setCookie(name, "", 0, sameSite);

/** The value of cookie `name` in a Cookie header, or null when it is absent, empty or sent more than once. */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && values[0] !== "" ? (values[0] ?? null) : null;
}
