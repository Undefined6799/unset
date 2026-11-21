// Ported from interfaces/http/routes/sign-in-state.ts (P1.20e): the same state and cookies, written through SvelteKit's
// cookies API instead of Set-Cookie strings. The Hono copy went at P1.20k.
// The browser state of signing in (plan §2 rule 2; §5.3). What binds a sign-in to the browser that started it: the
// appState POST /login writes (P2.05) and the callback reads back (P2.06), and the `__Host-oauth_nonce` cookie holding
// the same P1.16 nonce. The library keeps the appState sealed and single-use in app.oauth_state; the authorization
// server never sees it. P2.08: the `__Host-signed_out` marker, set at sign-out and cleared at the next sign-in, which
// makes that sign-in ask the server for its password again (`prompt=login`) rather than reuse its own session.

import type { Cookies } from "@sveltejs/kit";
import { type Did, parseDid } from "@unset/domains-identity";
import { type SafePath, safeReturnPath } from "@unset/shared-http";

export type AppState = {
  /** The P1.16 login nonce, also in this browser's nonce cookie. */
  readonly nonce: string;
  /** The account the form named, or null for the PDS chooser (any account on that server may come back). */
  readonly expectedDid: Did | null;
  readonly next: SafePath | null;
  /**
   * P2.05s: asked with prompt=none. Only such a flow may be asked once more, with a page, when the server needs one;
   * the second ask is not silent, so it can never loop. A state written before P2.05s reads as not silent.
   */
  readonly silent: boolean;
};

const NONCE = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The sign-in cookies, each host-only by its `__Host-` prefix (Secure, Path=/, no Domain; RFC 6265bis §4.1.3.2),
 * HttpOnly, with the SameSite and Max-Age interfaces/http gives it. Written through SvelteKit's `cookies` API (kit
 * 3.2.0 src/runtime/server/cookie.js), which serializes these options; values are base64url or "1", which its
 * encoder leaves unchanged. Read from the raw header (`cookieValue`), because `cookies.get` silently takes the first
 * of two.
 */
const COOKIES = {
  /** The P1.16 nonce. Lax, so the authorization server's redirect back (a top-level GET from another site) carries it. */
  nonce: { name: "__Host-oauth_nonce", sameSite: "lax", maxAge: 600 },
  /** P2.08: set at sign-out, cleared at the next sign-in or "No thanks"; makes that sign-in ask for the password. */
  signedOut: { name: "__Host-signed_out", sameSite: "lax", maxAge: 2_592_000 },
  /** The authorization URL waiting for /login/continue (P2.05): Strict, because only our own 303 leads there. */
  target: { name: "__Host-login_target", sameSite: "strict", maxAge: 120 },
  /**
   * P2.08b: the issuer origin recorded at sign-in, for the signed-out page's account link. The last browser's sign-out
   * deletes the token set that records it, so POST /logout carries it here: Strict, because only our own pages lead to
   * /signed-out (our 303, or GET /logout/done's same-site refresh after unset.cc's sign-out page), and short-lived.
   * Never a query parameter, which any site could link with another origin.
   */
  issuer: { name: "__Host-signed_out_issuer", sameSite: "strict", maxAge: 600 },
  /**
   * Alex 2026-11-21 (ADR 0083 decision 5): web's ticket that lets unset.cc wipe chat in this browser after POST /logout,
   * waiting for GET /logout/chat. Strict, because only our own 303 leads there; 60 s, the ticket's own life.
   */
  chatSignOut: { name: "__Host-chat_sign_out", sameSite: "strict", maxAge: 60 },
} as const;

export function appStateOf(state: AppState): string {
  const { nonce, expectedDid, next, silent } = state;
  return JSON.stringify({ v: 1, nonce, flow: "login", expectedDid, next, silent, startedAt: Date.now() });
}

/** The appState the library handed back, or null for anything not in the shape appStateOf writes. */
export function parseAppState(text: string): AppState | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, nonce, flow, expectedDid, next, silent, startedAt } = value as Record<string, unknown>;
  if (v !== 1 || flow !== "login" || typeof startedAt !== "number") return null;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) return null;
  const did = typeof expectedDid === "string" ? parseDid(expectedDid) : null;
  if (expectedDid !== null && did === null) return null;
  // Checked again on the way out, as on the way in: a stored path is still input.
  return { nonce, expectedDid: did, next: safeReturnPath(next), silent: silent === true };
}

export type SignInCookie = keyof typeof COOKIES;

const attributes = (cookie: SignInCookie) =>
  ({ path: "/", secure: true, httpOnly: true, sameSite: COOKIES[cookie].sameSite }) as const;

/** Sets `cookie` to `value` (base64url or "1", checked by the caller's own type) for its Max-Age. */
export function putCookie(cookies: Cookies, cookie: SignInCookie, value: string): void {
  if (!BASE64URL.test(value)) throw new RangeError(`${COOKIES[cookie].name}: value is not base64url`);
  cookies.set(COOKIES[cookie].name, value, { ...attributes(cookie), maxAge: COOKIES[cookie].maxAge });
}

/** Removes `cookie` (Max-Age=0, same attributes). */
export function dropCookie(cookies: Cookies, cookie: SignInCookie): void {
  cookies.delete(COOKIES[cookie].name, attributes(cookie));
}

/** True when the request sent `cookie` at all, valid or not: the page that reads it clears it (single use). */
export const cookieSent = (header: string | null, cookie: SignInCookie): boolean =>
  (header ?? "").split(";").some((pair) => pair.trim().startsWith(`${COOKIES[cookie].name}=`));

export const nonceFromCookies = (header: string | null): string | null => cookieValue(header, COOKIES.nonce.name);
export const signedOutFrom = (header: string | null): boolean => cookieValue(header, COOKIES.signedOut.name) === "1";

export const encodeTarget = (target: string): string => Buffer.from(target).toString("base64url");
/** The stored target as text, or null when the cookie is missing, doubled or not base64url. */
export function targetFromCookies(header: string | null): string | null {
  const encoded = cookieValue(header, COOKIES.target.name);
  if (encoded === null || !BASE64URL.test(encoded)) return null;
  return Buffer.from(encoded, "base64url").toString("utf8");
}

/** The carried chat sign-out ticket (base64url), or null when it is missing, doubled or not base64url. */
export function chatTicketFromCookies(header: string | null): string | null {
  const ticket = cookieValue(header, COOKIES.chatSignOut.name);
  return ticket !== null && BASE64URL.test(ticket) ? ticket : null;
}

/** `origin`, already checked with `issuerOrigin`, as the issuer cookie carries it. */
export const encodeIssuer = (origin: string): string => Buffer.from(origin).toString("base64url");
/**
 * The carried issuer origin, or null when the cookie is missing, doubled, not base64url or not a bare https origin.
 * A refusal is not logged: the value names the user's PDS (architecture 2026-10-19 04:15Z item 3, SE-7).
 */
export function issuerFromCookies(header: string | null): string | null {
  const encoded = cookieValue(header, COOKIES.issuer.name);
  if (encoded === null || !BASE64URL.test(encoded)) return null;
  const carried = Buffer.from(encoded, "base64url").toString("utf8");
  // We only ever write a bare origin, so anything else was not written by us.
  return issuerOrigin(carried) === carried ? carried : null;
}

/**
 * The https origin of a recorded issuer, or null when it is not one (P2.08b, narrowed by P2.08h). Refused: another
 * scheme, a user or password, a port other than the default, an IPv4 or IPv6 literal, `localhost`, a name under
 * `.localhost`, or a trailing dot. WHATWG `URL` on Node 26.12.0 serializes an IPv4 host as dotted decimal and an
 * IPv6 host in brackets, and it keeps a trailing dot (https://url.spec.whatwg.org/#concept-host-parser). The
 * carrier matches those shapes. The library already refuses a query, fragment or trailing slash
 * (@atproto/oauth-types 0.7.7 oauth-issuer-identifier.js).
 */
export function issuerOrigin(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  if (!dnsNameHost(url.hostname)) return null;
  return url.origin;
}

/** Four decimal octets, the form WHATWG gives an IPv4 address (0–255, no leading zero except 0). */
const IPV4 = /^(?:0|[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])(?:\.(?:0|[1-9]\d?|1\d{2}|2[0-4]\d|25[0-5])){3}$/;

/** A DNS hostname: not an address, not localhost, and not a trailing dot (P2.08h). `hostname` is WHATWG's. */
function dnsNameHost(hostname: string): boolean {
  if (hostname.endsWith(".") || hostname.startsWith("[") || IPV4.test(hostname)) return false;
  return hostname !== "localhost" && !hostname.endsWith(".localhost");
}

/** The value of the cookie `name` when exactly one is sent: two mean a confused or planted jar, and neither counts. */
export function cookieValue(header: string | null, name: string): string | null {
  const values = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${name}=`))
    .map((pair) => pair.slice(name.length + 1));
  return values.length === 1 ? (values[0] as string) : null;
}
