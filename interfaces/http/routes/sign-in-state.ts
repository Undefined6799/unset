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
/** The authorization URL waiting for /login/continue (P2.05): Strict, because only our own 303 leads there. */
const TARGET_COOKIE = "__Host-login_target";
const TARGET_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Strict";
const TARGET_TTL_S = 120;
const SIGNED_OUT_TTL_S = 2_592_000;
/**
 * P2.08b: the issuer origin recorded at sign-in, for the signed-out page's account link. The last browser's sign-out
 * deletes the token set that records it, so POST /logout carries it in this cookie: Strict, because only our own 303
 * leads to /signed-out, and short-lived. Never a query parameter, which any site could link with another origin.
 */
const ISSUER_COOKIE = "__Host-signed_out_issuer";
const ISSUER_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Strict";
const ISSUER_TTL_S = 600;

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

export const targetCookie = (target: string): string =>
  `${TARGET_COOKIE}=${Buffer.from(target).toString("base64url")}; ${TARGET_ATTRIBUTES}; Max-Age=${TARGET_TTL_S}`;
export const clearTargetCookie = (): string => `${TARGET_COOKIE}=; ${TARGET_ATTRIBUTES}; Max-Age=0`;
/** The stored target as text, or null when the cookie is missing, doubled or not base64url. */
export function targetFromCookies(header: string | null): string | null {
  const encoded = cookieValue(header, TARGET_COOKIE);
  if (encoded === null || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  return Buffer.from(encoded, "base64url").toString("utf8");
}
export const signedOutFrom = (header: string | null): boolean => cookieValue(header, SIGNED_OUT_COOKIE) === "1";

/** The cookie carrying `origin`, which the caller has already checked with `issuerOrigin`. */
export const issuerCookie = (origin: string): string =>
  `${ISSUER_COOKIE}=${Buffer.from(origin).toString("base64url")}; ${ISSUER_ATTRIBUTES}; Max-Age=${ISSUER_TTL_S}`;
export const clearIssuerCookie = (): string => `${ISSUER_COOKIE}=; ${ISSUER_ATTRIBUTES}; Max-Age=0`;
/** The carried issuer origin, or null when the cookie is missing, doubled, not base64url or not a bare https origin. */
export function issuerFromCookies(header: string | null): string | null {
  const encoded = cookieValue(header, ISSUER_COOKIE);
  if (encoded === null || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const carried = Buffer.from(encoded, "base64url").toString("utf8");
  // We only ever write a bare origin, so anything else was not written by us.
  return issuerOrigin(carried) === carried ? carried : null;
}

/**
 * The https origin of a recorded issuer, or null for another scheme or one with a user or password. The library
 * already refuses a query, fragment or trailing slash (@atproto/oauth-types 0.7.7 oauth-issuer-identifier.js); the
 * account link uses only the origin (book P2.08 `PdsAccountLink`: "<issuer origin>/").
 */
export function issuerOrigin(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" ? url.origin : null;
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
