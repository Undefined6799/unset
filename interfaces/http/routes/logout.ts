// Signing out (P2.08, remainder P2.08a; plan §5.3 "Logout"). POST only, behind the CSRF gate, so neither a link nor
// another site can sign a member out. This browser's session ends, and the browser is marked signed out so the next
// sign-in asks for the password again. Other browsers keep their sessions and the shared token set. The last browser
// revokes the grant: a refresh credential with nobody behind it is not kept (review F13). "Sign out everywhere" was
// removed (P2.08d; Alex, 2026-10-19 02:34:31Z). P2.08b: the signed-out page links the issuer recorded at sign-in,
// carried in a short-lived cookie because the last browser's revoke deletes the record. No DID in any log line.
import type { Did } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { AppError } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import { sessionClearCookie } from "../session-cookie.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import {
  clearIssuerCookie,
  clearNonceCookie,
  clearTargetCookie,
  issuerCookie,
  issuerCookieSent,
  issuerFromCookies,
  issuerOrigin,
  signedOutCookie,
} from "./sign-in-state.ts";

export type LogoutDeps = {
  /** This request's P2.03 session, or null. */
  readSession: (request: Request, deadline: AbortSignal) => Promise<Session | null>;
  /** Destroys this session and returns how many of the DID's sessions remain, in one transaction. */
  destroySession: (session: Session, deadline: AbortSignal) => Promise<number>;
  /** The issuer OAuth recorded at sign-in (the stored token set's `iss`), or null. Never a DID-document field. */
  issuerOf: (did: Did, signal: AbortSignal) => Promise<string | null>;
  /**
   * `OAuthClient.revoke` (@atproto/oauth-client 0.8.9, dist/oauth-client.js `revoke`). On success the library has
   * deleted the stored set. A throw means the authorization server was not confirmed; the set may still be there.
   */
  revokeGrant: (did: Did) => Promise<void>;
  /** `oauthSessionStore.del`: used when revoke throws, so no grant remains on our side. */
  deleteTokenSet: (did: Did, deadline: AbortSignal) => Promise<void>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  /** Our PDS's issuer origin: the signed-out page's link when no recorded issuer was carried. */
  pdsIssuer: string;
  log: Logger;
};

const FORM = "application/x-www-form-urlencoded";
/** Book P2.08: the revocation call gets 10 seconds, then we drop the stored set ourselves. */
const REVOKE_MS = 10_000;
/**
 * The issuer read's own deadline (P2.08h). 250 ms is well below `PG_CONNECT_TIMEOUT_MS`'s default of 2000
 * (`infrastructure/postgres/config.ts`). A hung store must not hold sign-out for the pool's connect wait.
 * `AbortSignal.timeout`: https://nodejs.org/docs/latest-v26.x/api/globals.html#abortsignaltimeoutdelay (Node 26.12.0).
 */
export const ISSUER_READ_MS = 250;

class RevokeTimeout extends Error {
  constructor() {
    super("revoke timed out");
    this.name = "RevokeTimeout";
  }
}

function className(cause: unknown): string {
  return cause instanceof Error && cause.name !== "" ? cause.name : "Error";
}

/** The 303 to the signed-out page, carrying `issuer` (an origin) for its account link, or clearing a stale one. */
function finish(location: string, issuer: string | null): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  headers.append("set-cookie", sessionClearCookie());
  // A sign-in started before this one ends here too: its authorization was made without prompt=login.
  headers.append("set-cookie", clearNonceCookie());
  headers.append("set-cookie", clearTargetCookie());
  headers.append("set-cookie", signedOutCookie());
  headers.append("set-cookie", issuer === null ? clearIssuerCookie() : issuerCookie(issuer));
  return new Response(null, { status: 303, headers });
}

/** Settles with `work`, or rejects with the signal's reason once `deadline` aborts. Does not cancel `work`. */
function untilAbort<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  if (deadline.aborted) return Promise.reject(deadline.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(deadline.reason);
    deadline.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => deadline.removeEventListener("abort", onAbort));
  });
}

function withTimeout(work: Promise<void>, deadline: AbortSignal): Promise<void> {
  if (deadline.aborted) return Promise.reject(new RevokeTimeout());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RevokeTimeout()), REVOKE_MS);
    const onAbort = () => reject(new RevokeTimeout());
    deadline.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      deadline.removeEventListener("abort", onAbort);
    });
  });
}

export function logoutRoutes(deps: LogoutDeps): Route[] {
  /** Revoke the grant. On any failure the stored set is deleted here, so no grant remains on our side. */
  async function revokeOrDrop(did: Did, deadline: AbortSignal): Promise<void> {
    try {
      await withTimeout(deps.revokeGrant(did), deadline);
    } catch (cause: unknown) {
      deps.log.warn("oauth.revoke_failed", { kind: className(cause) });
      await deps.deleteTokenSet(did, deadline).catch((drop: unknown) => {
        deps.log.warn("oauth.revoke_failed", { kind: className(drop) });
      });
    }
  }

  function signedOutBody(carried: string | null) {
    const issuer = carried ?? deps.pdsIssuer;
    return deps.screens.signedOut({ issuer, ours: issuer === deps.pdsIssuer });
  }

  /**
   * The recorded issuer's origin. The read has its own short deadline and is not the request's: a timeout or any
   * error drops the link (the page then links ours) and sign-out continues. The read is never awaited past the
   * deadline, even when it ignores the signal.
   */
  async function recordedIssuer(did: Did): Promise<string | null> {
    const deadline = AbortSignal.timeout(ISSUER_READ_MS);
    const pending = deps.issuerOf(did, deadline);
    pending.catch(() => undefined);
    try {
      const issuer = await untilAbort(pending, deadline);
      return issuer === null ? null : issuerOrigin(issuer);
    } catch (cause: unknown) {
      deps.log.warn("auth.logout_issuer_unknown", { kind: className(cause) });
      return null;
    }
  }

  return [
    defineRoute({
      method: "POST",
      path: "/logout",
      group: "app",
      accepts: [FORM],
      bodyLimit: 1024,
      rateLimit: "default",
      mutates: true,
      session: "none",
      handler: async ({ request, deadline }) => {
        const session = await deps.readSession(request, deadline);
        if (session === null) return finish("/signed-out", null);
        // Read before anything is destroyed: the last browser's revoke deletes the token set that records it, and an
        // overlapping second POST for the same session must carry the same issuer, not find it already gone.
        const issuer = await recordedIssuer(session.did);
        // A failed delete is a retryable 503 (book P2.08 step 3), and the cookie stays so the retry finds it.
        const remaining = await deps.destroySession(session, deadline).catch((cause: unknown) => {
          throw new AppError("logout.failed", { cause });
        });
        deps.log.info("auth.logout_this_browser");
        // Last browser: revoke outside the transaction. The count saw this delete. No unconfirmed notice (F13).
        if (remaining === 0) await revokeOrDrop(session.did, deadline);
        return finish("/signed-out", issuer);
      },
    }),
    defineRoute({
      method: "GET",
      path: "/signed-out",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: async ({ request, deadline }) => {
        // A browser signed in again (Back after a new sign-in, a typed URL) is not told it is signed out.
        const cookie = request.headers.get("cookie");
        if ((await deps.readSession(request, deadline)) !== null) {
          const signedIn = new Response(null, {
            status: 303,
            headers: { location: "/did", "cache-control": "no-store" },
          });
          // Another tab signed in first: the previous account's issuer must not outlive this redirect.
          if (issuerCookieSent(cookie)) signedIn.headers.append("set-cookie", clearIssuerCookie());
          return signedIn;
        }
        const response = deps.page({
          group: "app",
          request,
          title: "Signed out",
          shell: {},
          // The cookie, never the query: only our own POST /logout writes it, and its value is re-checked here.
          // "Ours" is string equality with our issuer, never a suffix match (architecture 04:15Z item 4).
          body: signedOutBody(issuerFromCookies(cookie)),
        });
        // Single use: a reload links our PDS (item 1).
        if (issuerCookieSent(cookie)) response.headers.append("set-cookie", clearIssuerCookie());
        return response;
      },
    }),
  ];
}
