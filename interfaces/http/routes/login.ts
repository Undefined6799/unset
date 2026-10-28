// Signing in (P2.05; plan §2 rules 4, 5, 6; §5.3 "Login and signup"). GET /login shows the form, one button to our PDS
// since P2.05r. POST /login works out
// which account and server the browser goes to, issues a single-use nonce (P1.16) bound to this browser by a `__Host-`
// cookie, starts the authorization with the nonce, the expected DID and the return path in the library's sealed
// appState, and answers with the continue page. GET /login/continue sends the browser on to the authorization server.
// Nothing here signs anyone in: the callback (P2.06) checks the nonce cookie against the appState it gets back.
//
// The authorization URL waits for the continue page in a second `__Host-` cookie, never in the query, so the page can
// only send a browser where that browser's own POST pointed it: a link to /login/continue opened anywhere else finds
// no cookie. SameSite=Strict, because only our own 303 leads there.
import type { Did, Handle, HandleResolution } from "@unset/domains-identity";
import { parseDid, parseHandle } from "@unset/domains-identity";
import type { AuthorizeResult } from "@unset/infrastructure-pds";
import type { SessionRead } from "@unset/infrastructure-session";
import { type ErrorCode, readErrorParam, withErrorParam } from "@unset/shared-errors";
import { defineRoute, type Route, type SafePath, safeReturnPath } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
// A whole-statement type import: Node erases it, so the server never loads the kit (its index reaches .tsx files).
import type { HrefScheme, SafeHref } from "@unset/shared-ui";
import { single } from "../form-field.ts";
import { redirect } from "../redirect.ts";
import { sessionClearCookie } from "../session-cookie.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { appStateOf, nonceCookie, signedOutFrom, targetCookie, targetFromCookies } from "./sign-in-state.ts";

export type LoginDeps = {
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /** The kit's link validator, from the render build. */
  safeHref: WebRender["safeHref"];
  /** P2.03's read of the request's session cookie: a live session, and whether a dead cookie should be cleared. */
  readSession: (request: Request, deadline: AbortSignal) => Promise<SessionRead>;
  resolveHandle: (handle: Handle) => Promise<HandleResolution>;
  /** A P1.16 `login.nonce`, valid 10 minutes. */
  issueNonce: (deadline: AbortSignal) => Promise<string>;
  authorize: (
    input: string,
    options: { appState: string; prompt?: "login"; deadline: AbortSignal },
  ) => Promise<AuthorizeResult>;
  /** Our PDS's host: the chooser's authorization server is `https://` and this. */
  pdsHost: string;
  /** What a name typed without a dot is completed with. */
  handleDomain: string;
  /** OAUTH_ALLOW_HTTP: a local stack may send the browser to plain HTTP. */
  allowHttp: boolean;
  log: Logger;
};

/** Where the authorization server is chosen from: a handle or DID, or our PDS's own sign-in page. */
type Account = { readonly input: string; readonly expectedDid: Did | null };

const FORM = "application/x-www-form-urlencoded";
const BODY_LIMIT_BYTES = 2048;

/** Back to the form with an error, keeping a valid return path. */
const back = (code: ErrorCode, next: SafePath | null): Response =>
  redirect(withErrorParam(next === null ? "/login" : `/login?${new URLSearchParams({ next })}`, code));

export function loginRoutes(deps: LoginDeps): Route[] {
  const issuer = `https://${deps.pdsHost}`;
  const schemes: readonly HrefScheme[] = deps.allowHttp ? ["https:", "http:"] : ["https:"];

  /** Steps 3 to 5 of the book's algorithm: the account to authorize, or the code to send the form back with. */
  async function chooseAccount(form: URLSearchParams): Promise<Account | ErrorCode> {
    const typed = (single(form, "handle") ?? "").trim();
    if (single(form, "intent") === "chooser" || typed === "") return { input: issuer, expectedDid: null };
    const name = typed.replace(/^@/, "");
    if (name.startsWith("did:")) {
      // DIDs are case-sensitive: parsed as typed, never lowercased into another account.
      const did = parseDid(name);
      return did === null ? "login.handle_invalid" : { input: did, expectedDid: did };
    }
    const lower = name.toLowerCase();
    const handle = parseHandle(lower.includes(".") ? lower : `${lower}.${deps.handleDomain}`);
    if (handle === null) return "login.handle_invalid";
    // Resolved here for the not-found / unavailable split before any server is asked; the library resolves again and
    // checks that the DID document claims the handle (P2.05a), and P2.06 refuses a different account.
    const found = await deps.resolveHandle(handle);
    if (found.status === "not_found") return "login.handle_not_found";
    if (found.status === "unavailable") return "login.identity_unavailable";
    return { input: handle, expectedDid: found.did };
  }

  /** startAuth: the nonce, the authorization, then the two cookies and the continue page. */
  async function startAuth(request: Request, account: Account, next: SafePath | null, deadline: AbortSignal) {
    const nonce = await deps.issueNonce(deadline);
    const appState = appStateOf({ nonce, expectedDid: account.expectedDid, next });
    const prompt = signedOutFrom(request.headers.get("cookie")) ? ({ prompt: "login" } as const) : {};
    const result = await deps.authorize(account.input, { appState, ...prompt, deadline });
    // A failure leaves the nonce unused: it never reached a browser, and it expires on its own.
    if (!result.ok) return back(`login.${result.reason}`, next);
    const target = deps.safeHref(result.url.href, schemes);
    if (target === null) {
      deps.log.warn("oauth.authorize_failed", { kind: "insecure_target" });
      return back("login.failed", next);
    }
    return redirect("/login/continue", [nonceCookie(nonce), targetCookie(target)]);
  }

  /** The target this browser's POST stored, if it is still a link of an allowed kind. */
  function storedTarget(request: Request): SafeHref | null {
    const stored = targetFromCookies(request.headers.get("cookie"));
    return stored === null ? null : deps.safeHref(stored, schemes);
  }

  /**
   * Where the sign-in box's Close goes (P2.05n; Alex, 2026-10-23: "back to the page to which I came from"): the page
   * the Referer names, if it is on this request's host, which the kit's host check already held to
   * HTTP_ALLOWED_HOSTS. Only the host is compared, since TLS may end at the edge. Referrer-Policy same-origin
   * (shared/http/csp/headers.ts) sends it only between our own pages. A sign-in page, or the protected page `next`
   * names, would only bounce back here, so those, and anything else, go home.
   */
  function closeTarget(request: Request, next: SafePath | null): string {
    const referer = request.headers.get("referer");
    if (referer === null || !URL.canParse(referer)) return "/";
    const from = new URL(referer);
    const ours = from.host === request.headers.get("host");
    if (!ours || from.pathname === "/login" || from.pathname.startsWith("/login/")) return "/";
    const back = safeReturnPath(`${from.pathname}${from.search}`);
    return back === null || back === next ? "/" : back;
  }

  return [
    defineRoute({
      method: "GET",
      path: "/login",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: async ({ request, deadline }) => {
        const query = new URL(request.url).searchParams;
        const error = readErrorParam(query);
        const { session, clearCookie } = await deps.readSession(request, deadline);
        // A signed-in visitor has nothing to sign in to, unless a failed sign-in brought them back to read why.
        if (session !== null && error === null) return redirect("/did");
        // P2.05m: the page is the sign-in dialog alone, with no shell, so the screen shows the checked ?error= code.
        const next = safeReturnPath(query.get("next"));
        const close = closeTarget(request, next);
        const body = deps.screens.login({ next, error, pdsHost: deps.pdsHost, close });
        const response = deps.page({ group: "app", request, title: "Sign in", body, islands: "off" });
        if (clearCookie) response.headers.append("set-cookie", sessionClearCookie());
        return response;
      },
    }),
    defineRoute({
      method: "POST",
      path: "/login",
      group: "app",
      accepts: [FORM],
      bodyLimit: BODY_LIMIT_BYTES,
      rateLimit: "login",
      mutates: true,
      session: "none",
      handler: async ({ request, deadline }) => {
        // P2.05p: the in-place box posts here from public pages too, which cannot vary on the session cookie. A
        // signed-in browser goes to its profile, as on GET, and no authorization starts to replace its session.
        if ((await deps.readSession(request, deadline)).session !== null) return redirect("/did");
        const form = new URLSearchParams(await request.text());
        const next = safeReturnPath(single(form, "next"));
        const account = await chooseAccount(form);
        if (typeof account === "string") return back(account, next);
        return startAuth(request, account, next, deadline);
      },
    }),
    defineRoute({
      method: "GET",
      path: "/login/continue",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: ({ request }) => {
        const target = storedTarget(request);
        if (target === null) return back("login.expired", null);
        const host = new URL(target).host;
        const body = deps.screens.loginContinue({ target, host, ours: host === deps.pdsHost });
        return deps.page({ group: "app", request, title: "Continue signing in", body, shell: {} });
      },
    }),
  ];
}
