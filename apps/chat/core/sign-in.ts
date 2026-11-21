// The page's half of the sign-in hop (ADR 0099 decisions 2 and 4; ADR 0093 decision 4). web sends the tab to the
// door's return path with the ticket in the fragment (interfaces/web chat-sign-in.ts), which is this page. The page
// takes the ticket, removes it from the address bar and history before anything else runs (History API
// replaceState, https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-replacestate), posts it to
// the redeem path and keeps what comes back in memory only: nothing here writes web storage, a cookie or the URL.
import type { ChatSession } from "./chat.ts";

export const RETURN_PATH = "/sign-in/return";
const REDEEM_PATH = "/sign-in/redeem";
/** Renew this long before the token ends, so a running sync never meets a dead token (ADR 0093 decision 1). */
const RENEW_AHEAD_MS = 60_000;
const USER_ID = /^@[a-z0-9._=/+-]+:[A-Za-z0-9.-]+$/;
const DEVICE_ID = /^[A-Za-z0-9-]{10,32}$/;
const CODE = /^chat\.[a-z_]{1,40}$/;

export type Redeemed =
  | { readonly kind: "signed_in"; readonly session: ChatSession; readonly returnTo: string }
  | { readonly kind: "refused"; readonly code: string };

type Tab = {
  readonly location: { readonly pathname: string; readonly hash: string };
  readonly history: { replaceState(data: unknown, unused: string, url: string): void };
};
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The ticket in the fragment, or null; the fragment is gone from the address bar and history either way. */
export function takeTicket(tab: Tab): string | null {
  const tickets = new URLSearchParams(tab.location.hash.slice(1)).getAll("ticket");
  tab.history.replaceState(null, "", tab.location.pathname);
  return tickets.length === 1 && tickets[0] !== "" ? (tickets[0] ?? null) : null;
}

/** The door's sign-in hop, coming back to `path` (the door checks it again, safeReturnPath). */
export const hopPath = (path: string): string => `/sign-in?return=${encodeURIComponent(path)}`;

/** How long to wait before re-running the hop for a fresh token on the same device. */
export const renewDelayMs = (expiresAtMs: number, nowMs: number): number =>
  Math.max(0, expiresAtMs - RENEW_AHEAD_MS - nowMs);

const UNAVAILABLE = { kind: "refused", code: "chat.unavailable" } as const;
type Refused = { readonly kind: "refused"; readonly code: string };

/** POST the ticket to the door's `path`; its 200 body, or a fixed refusal code. */
export async function postTicket(
  fetchFn: Fetch,
  path: string,
  ticket: string,
  deadline: AbortSignal,
): Promise<{ readonly kind: "ok"; readonly body: unknown } | Refused> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetchFn(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: deadline,
    });
    body = await response.json();
  } catch {
    return UNAVAILABLE;
  }
  if (response.ok) return { kind: "ok", body };
  const code = (body as { error?: unknown } | null)?.error;
  return typeof code === "string" && CODE.test(code) ? { kind: "refused", code } : UNAVAILABLE;
}

/** POST the ticket to the door; its answer as our session, or a fixed refusal code. */
export async function redeem(fetchFn: Fetch, ticket: string, deadline: AbortSignal): Promise<Redeemed> {
  const answer = await postTicket(fetchFn, REDEEM_PATH, ticket, deadline);
  return answer.kind === "ok" ? (signedIn(answer.body) ?? UNAVAILABLE) : answer;
}

/** The door's 200 answer, checked field by field; null when any field is not what the door sends. */
function signedIn(body: unknown): Redeemed | null {
  const session = sessionOf(body);
  if (session === null) return null;
  const { newDevice, returnTo } = body as Record<string, unknown>;
  if (typeof newDevice !== "boolean") return null;
  if (typeof returnTo !== "string" || !returnTo.startsWith("/") || /^\/[/\\]/.test(returnTo)) return null;
  return { kind: "signed_in", returnTo, session: { ...session, newDevice } };
}

/** The session fields of a door answer, checked one by one; null when any is not what the door sends. */
export function sessionOf(body: unknown): Omit<ChatSession, "newDevice"> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { accessToken, userId, deviceId, expiresAt, storageKey } = body as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken === "") return null;
  if (typeof userId !== "string" || !USER_ID.test(userId)) return null;
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return null;
  const expiresAtMs = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(expiresAtMs)) return null;
  const key = typeof storageKey === "string" ? base64url(storageKey) : null;
  if (key === null || key.length !== 32) return null;
  return { accessToken, userId, deviceId, expiresAtMs, storageKey: key };
}

/** The bytes of unpadded base64url `text`, or null; a length no encoding has (atob's InvalidCharacterError) is null. */
function base64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
