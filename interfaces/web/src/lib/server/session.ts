// Reading the browser session in the gate (P2.03; plan section 5.3). The cookie is `__Host-sid` as interfaces/http
// sets it; signing in and out (P1.20e) write it. Read-only here: onboarding and the email recheck join in P1.20f.
import type { RequestEvent } from "@sveltejs/kit";
import type { Session } from "@unset/infrastructure-session";
import { services } from "./compose.ts";
import { issuerOrigin } from "./sign-in-state.ts";

export const SESSION_COOKIE = "__Host-sid";

/**
 * The session cookie's value when exactly one is sent, else null: two cookies of that name mean a confused or planted
 * jar, and neither is trusted (as interfaces/http/session-cookie.ts). SvelteKit's `cookies.get` returns the first one
 * silently, so the header is read here instead.
 */
export function sessionCookieValue(header: string | null): string | null {
  const values = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${SESSION_COOKIE}=`))
    .map((pair) => pair.slice(SESSION_COOKIE.length + 1));
  return values.length === 1 ? (values[0] as string) : null;
}

/** The session the gate read for each request, so a route that ends it (sign-out) does not read it again. */
const gateRead = new WeakMap<Request, Session>();

/** The request's live session, from one store read; an unknown, malformed or expired cookie is cleared. */
export async function sessionOf(event: RequestEvent, deadline: AbortSignal): Promise<Session | undefined> {
  const cookieValue = sessionCookieValue(event.request.headers.get("cookie"));
  if (cookieValue === null) return undefined;
  const result = await services().sessions.read({ key: event.request, cookieValue, deadline });
  if (result.clearCookie) dropSessionCookie(event.cookies);
  if (result.session) gateRead.set(event.request, result.session);
  return result.session ?? undefined;
}

/** The session the gate read for this request, or undefined (a visitor, or a route whose group reads none). */
export const gateSession = (event: RequestEvent): Session | undefined => gateRead.get(event.request);

/** The issuer origin a session carries, checked again on the way out (interfaces/http routes/account-issuer.ts). */
export function sessionIssuerOrigin(session: Session | undefined): string | null | undefined {
  const stored = session?.issuerOrigin ?? null;
  if (stored === null) return undefined;
  return issuerOrigin(stored) === stored ? stored : null;
}

/** The session cookie for a new session (P2.03): host-only, HttpOnly, Lax, living as long as the session can. */
export function putSessionCookie(cookies: RequestEvent["cookies"], value: string, maxAgeS: number): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RangeError("session cookie: value is not base64url");
  cookies.set(SESSION_COOKIE, value, { path: "/", secure: true, httpOnly: true, sameSite: "lax", maxAge: maxAgeS });
}

/** Removes the session cookie. */
export function dropSessionCookie(cookies: RequestEvent["cookies"]): void {
  cookies.delete(SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "lax" });
}
