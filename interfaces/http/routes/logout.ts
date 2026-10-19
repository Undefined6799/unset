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
  issuerOf: (did: Did) => Promise<string | null>;
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

  /** The recorded issuer's origin. An unreadable record must not block signing out; the page then links ours. */
  async function recordedIssuer(did: Did): Promise<string | null> {
    try {
      const issuer = await deps.issuerOf(did);
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
        // A failed delete is a retryable 503 (book P2.08 step 3), and the cookie stays so the retry finds it.
        const remaining = await deps.destroySession(session, deadline).catch((cause: unknown) => {
          throw new AppError("logout.failed", { cause });
        });
        deps.log.info("auth.logout_this_browser");
        // Read before the revoke below, which deletes the token set that records it.
        const issuer = await recordedIssuer(session.did);
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
        if ((await deps.readSession(request, deadline)) !== null) {
          return new Response(null, { status: 303, headers: { location: "/did", "cache-control": "no-store" } });
        }
        const cookie = request.headers.get("cookie");
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
