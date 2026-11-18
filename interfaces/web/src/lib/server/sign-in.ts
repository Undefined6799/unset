// Signing in (P2.05; plan §2 rules 4, 5, 6; §5.3 "Login and signup"), ported from interfaces/http/routes/login.ts for
// the SvelteKit pages under src/routes/login (P1.20e). POST /login works out which account and server the browser goes
// to, issues a single-use nonce (P1.16) bound to this browser by a `__Host-` cookie, starts the authorization with the
// nonce, the expected DID and the return path in the library's sealed appState, and sends the browser to the continue
// page. Nothing here signs anyone in: the callback (P2.06, oauth-callback.ts) checks the nonce cookie against the
// appState it gets back. The authorization URL waits for the continue page in a second, Strict cookie, never in the
// query, so that page can only send a browser where that browser's own POST pointed it.
import { type Cookies, redirect } from "@sveltejs/kit";
import { type Did, parseDid, parseHandle, resolveHandle } from "@unset/domains-identity";
import { authorize } from "@unset/infrastructure-pds";
import { PURPOSES, withClient } from "@unset/infrastructure-postgres";
import { type ErrorCode, withErrorParam } from "@unset/shared-errors";
import { type SafePath, safeReturnPath } from "@unset/shared-http";
import { services } from "./compose.ts";
import { config } from "./runtime.ts";
import { type HrefScheme, type SafeHref, safeHref } from "@unset/shared-safe-href";
import { appStateOf, putCookie, signedOutFrom, targetFromCookies } from "./sign-in-state.ts";

/** Where the authorization server is chosen from: a handle or DID, or our PDS's own sign-in page. */
type Account = { readonly input: string; readonly expectedDid: Did | null };

export type AuthorizationTarget =
  | { readonly ok: true; readonly target: SafeHref }
  | { readonly ok: false; readonly code: ErrorCode };

/** A local stack (OAUTH_ALLOW_HTTP) may send the browser to plain HTTP; nothing else may. */
const schemes = (): readonly HrefScheme[] => (config.OAUTH_ALLOW_HTTP ? ["https:", "http:"] : ["https:"]);

/** The one value of `name`, or null when it is missing, repeated or a file. */
export function single(form: FormData, name: string): string | null {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

/** Back to the form with an error, keeping a valid return path. Throws SvelteKit's 303. */
export function back(code: ErrorCode, next: SafePath | null): never {
  redirect(303, withErrorParam(next === null ? "/login" : `/login?${new URLSearchParams({ next })}`, code));
}

/** The authorization URL for `input`, as a link of an allowed kind, or the code the sign-in form shows. */
export async function authorizationTarget(
  input: string,
  options: { appState: string; prompt?: "login" | "none"; deadline: AbortSignal },
): Promise<AuthorizationTarget> {
  const { oauth, pdsIssuer, log } = services();
  const result = await authorize(oauth.client, input, { ...options, ownIssuer: pdsIssuer, log });
  if (!result.ok) return { ok: false, code: `login.${result.reason}` };
  const target = safeHref(result.url.href, schemes());
  if (target === null) {
    log.warn("oauth.authorize_failed", { kind: "insecure_target" });
    return { ok: false, code: "login.failed" };
  }
  return { ok: true, target };
}

/** Steps 3 to 5 of the book's algorithm: the account to authorize, or the code to send the form back with. */
async function chooseAccount(form: FormData): Promise<Account | ErrorCode> {
  const typed = (single(form, "handle") ?? "").trim();
  if (single(form, "intent") === "chooser" || typed === "") {
    return { input: `https://${config.PDS_HOSTNAME}`, expectedDid: null };
  }
  const name = typed.replace(/^@/, "");
  if (name.startsWith("did:")) {
    // DIDs are case-sensitive: parsed as typed, never lowercased into another account.
    const did = parseDid(name);
    return did === null ? "login.handle_invalid" : { input: did, expectedDid: did };
  }
  const lower = name.toLowerCase();
  const handle = parseHandle(lower.includes(".") ? lower : `${lower}${config.HANDLE_SUFFIX}`);
  if (handle === null) return "login.handle_invalid";
  // Resolved here for the not-found / unavailable split before any server is asked; the library resolves again and
  // checks that the DID document claims the handle (P2.05a), and the callback refuses a different account.
  const found = await resolveHandle(services().network, handle);
  if (found.status === "not_found") return "login.handle_not_found";
  if (found.status === "unavailable") return "login.identity_unavailable";
  return { input: handle, expectedDid: found.did };
}

/** POST /login after the gate: the account, the nonce, the authorization, then the two cookies. Always throws a 303. */
export async function startSignIn(request: Request, cookies: Cookies, deadline: AbortSignal): Promise<never> {
  const form = await request.formData();
  const next = safeReturnPath(single(form, "next"));
  const account = await chooseAccount(form);
  if (typeof account === "string") back(account, next);
  const { pool, nonces } = services();
  const nonce = await withClient(pool, deadline, (db) =>
    nonces.issue(db, "login.nonce", { ttlS: PURPOSES["login.nonce"] }),
  );
  // P2.05s: silent first, so a browser signed in at the PDS that allowed unset before sees no PDS page. After a
  // sign-out the server asks for the password instead, until "No thanks" or the next sign-in clears the marker.
  const signedOut = signedOutFrom(request.headers.get("cookie"));
  const appState = appStateOf({ nonce, expectedDid: account.expectedDid, next, silent: !signedOut });
  const sent = await authorizationTarget(account.input, { appState, prompt: signedOut ? "login" : "none", deadline });
  // A failure leaves the nonce unused: it never reached a browser, and it expires on its own.
  if (!sent.ok) back(sent.code, next);
  putCookie(cookies, "nonce", nonce);
  putCookie(cookies, "target", Buffer.from(sent.target).toString("base64url"));
  redirect(303, "/login/continue");
}

/** The target this browser's POST stored, if it is still a link of an allowed kind. */
export function storedTarget(request: Request): SafeHref | null {
  const stored = targetFromCookies(request.headers.get("cookie"));
  return stored === null ? null : safeHref(stored, schemes());
}

/**
 * Where the sign-in box's Close goes (P2.05n; Alex, 2026-10-23: "back to the page to which I came from"): the page the
 * Referer names, if it is on this request's host, which server.ts's host check already held to HTTP_ALLOWED_HOSTS.
 * Only the host is compared, since TLS may end at the edge. Referrer-Policy same-origin sends it only between our own
 * pages. A sign-in page, or the protected page `next` names, would only bounce back here, so those go home.
 */
export function closeTarget(request: Request, next: SafePath | null): string {
  const referer = request.headers.get("referer");
  if (referer === null || !URL.canParse(referer)) return "/";
  const from = new URL(referer);
  const ours = from.host === request.headers.get("host");
  if (!ours || from.pathname === "/login" || from.pathname.startsWith("/login/")) return "/";
  const back = safeReturnPath(`${from.pathname}${from.search}`);
  return back === null || back === next ? "/" : back;
}
