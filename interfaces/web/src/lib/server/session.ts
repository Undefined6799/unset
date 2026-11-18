// Reading the browser session in the gate (P2.03; plan section 5.3). The cookie is `__Host-sid` as interfaces/http
// sets it; signing in and out (P1.20e) write it. Read-only here: onboarding and the email recheck join in P1.20f.
import type { RequestEvent } from "@sveltejs/kit";
import { services } from "./compose.ts";

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

/** The request's signed-in DID, from one store read; an unknown, malformed or expired cookie is cleared. */
export async function sessionDidOf(event: RequestEvent, deadline: AbortSignal): Promise<string | undefined> {
  const cookieValue = sessionCookieValue(event.request.headers.get("cookie"));
  if (cookieValue === null) return undefined;
  const read = await services().sessions.read({ key: event.request, cookieValue, deadline });
  if (read.clearCookie)
    event.cookies.delete(SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "lax" });
  return read.session?.did;
}
