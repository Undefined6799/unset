// The session cookie (P2.03; plan section 5.3 "Sessions"). Host-only by the `__Host-` prefix, which requires Secure,
// Path=/ and a host-only scope, so no member subdomain ever receives it (RFC 6265bis §4.1.3.2, as theme.ts). HttpOnly
// keeps it from scripts, and SameSite=Lax keeps it off cross-site subrequests while a top-level navigation carries it.
// These functions return header values; the route puts them on its Response, as the theme cookie does.
export const SESSION_COOKIE = "__Host-sid";
const ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
/** The store's cookie values are base64url; anything else never reaches a header (RFC 6265 section 4.1.1). */
const SAFE_VALUE = /^[A-Za-z0-9_-]+$/;

/** The Set-Cookie value for a new session; `maxAgeS` is the session's absolute lifetime in whole seconds. */
export function sessionSetCookie(value: string, maxAgeS: number): string {
  if (!SAFE_VALUE.test(value)) throw new RangeError("session cookie: value is not base64url");
  if (!Number.isSafeInteger(maxAgeS) || maxAgeS < 1) throw new RangeError("session cookie: Max-Age must be >= 1 s");
  return `${SESSION_COOKIE}=${value}; ${ATTRIBUTES}; Max-Age=${maxAgeS}`;
}

/** The Set-Cookie value that removes the session cookie. */
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
}

/**
 * The session cookie's value when exactly one is sent, else null: two cookies of that name mean a confused or
 * planted jar, and neither is trusted. The value is passed on as sent; the store refuses anything it did not issue.
 */
export function sessionCookieValue(header: string | null): string | null {
  const values = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${SESSION_COOKIE}=`))
    .map((pair) => pair.slice(SESSION_COOKIE.length + 1));
  return values.length === 1 ? (values[0] as string) : null;
}
