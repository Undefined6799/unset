// The browser state of signing in (plan §2 rule 2; §5.3). What binds a sign-in to the browser that started it: the
// appState POST /login writes (P2.05) and the callback reads back (P2.06), and the `__Host-oauth_nonce` cookie holding
// the same P1.16 nonce. The library keeps the appState sealed and single-use in app.oauth_state; the authorization
// server never sees it. P2.08: the `__Host-signed_out` marker, set at sign-out and cleared at the next sign-in, which
// makes that sign-in ask the server for its password again (`prompt=login`) rather than reuse its own session.
import { type Did, parseDid } from "@unset/domains-identity";
import { type SafePath, safeReturnPath } from "@unset/shared-http";

export type AppState = {
  /** The P1.16 login nonce, also in this browser's nonce cookie. */
  readonly nonce: string;
  /** The account the form named, or null for the PDS chooser (any account on that server may come back). */
  readonly expectedDid: Did | null;
  readonly next: SafePath | null;
};

const NONCE = /^[A-Za-z0-9_-]{43}$/;
const NONCE_COOKIE = "__Host-oauth_nonce";
/** Lax, so the authorization server's redirect back (a top-level GET from another site) carries the nonce. */
const NONCE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
const NONCE_TTL_S = 600;
const SIGNED_OUT_COOKIE = "__Host-signed_out";
const SIGNED_OUT_TTL_S = 2_592_000;

export function appStateOf(state: AppState): string {
  const { nonce, expectedDid, next } = state;
  return JSON.stringify({ v: 1, nonce, flow: "login", expectedDid, next, startedAt: Date.now() });
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
  const { v, nonce, flow, expectedDid, next, startedAt } = value as Record<string, unknown>;
  if (v !== 1 || flow !== "login" || typeof startedAt !== "number") return null;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) return null;
  const did = typeof expectedDid === "string" ? parseDid(expectedDid) : null;
  if (expectedDid !== null && did === null) return null;
  // Checked again on the way out, as on the way in: a stored path is still input.
  return { nonce, expectedDid: did, next: safeReturnPath(next) };
}

export const nonceCookie = (nonce: string): string =>
  `${NONCE_COOKIE}=${nonce}; ${NONCE_ATTRIBUTES}; Max-Age=${NONCE_TTL_S}`;
export const clearNonceCookie = (): string => `${NONCE_COOKIE}=; ${NONCE_ATTRIBUTES}; Max-Age=0`;
export const nonceFromCookies = (header: string | null): string | null => cookieValue(header, NONCE_COOKIE);

export const signedOutCookie = (): string => `${SIGNED_OUT_COOKIE}=1; ${NONCE_ATTRIBUTES}; Max-Age=${SIGNED_OUT_TTL_S}`;
export const clearSignedOutCookie = (): string => `${SIGNED_OUT_COOKIE}=; ${NONCE_ATTRIBUTES}; Max-Age=0`;
export const signedOutFrom = (header: string | null): boolean => cookieValue(header, SIGNED_OUT_COOKIE) === "1";

/** The value of the cookie `name` when exactly one is sent: two mean a confused or planted jar, and neither counts. */
export function cookieValue(header: string | null, name: string): string | null {
  const values = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${name}=`))
    .map((pair) => pair.slice(name.length + 1));
  return values.length === 1 ? (values[0] as string) : null;
}
