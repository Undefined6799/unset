// Signing out (P2.08, remainder P2.08a; plan §5.3 "Logout"). POST only, behind the CSRF gate, so neither a link nor
// another site can sign a member out. This browser's session ends, and the browser is marked signed out so the next
// sign-in asks for the password again. Other browsers keep their sessions and the shared token set. The last browser,
// and "sign out everywhere", revoke the grant: a refresh credential with nobody behind it is not kept (review F13).
// No DID in any log line.
import type { Did } from "@unset/domains-identity";
import type { Session } from "@unset/infrastructure-session";
import { AppError, readErrorParam, withErrorParam } from "@unset/shared-errors";
import { defineRoute, type Route } from "@unset/shared-http";
import type { Logger } from "@unset/shared-log";
import { sessionClearCookie } from "../session-cookie.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";
import { clearNonceCookie, clearTargetCookie, signedOutCookie } from "./sign-in-state.ts";

export type LogoutDeps = {
  /** This request's P2.03 session, or null. */
  readSession: (request: Request, deadline: AbortSignal) => Promise<Session | null>;
  /** Destroys this session and returns how many of the DID's sessions remain, in one transaction. */
  destroySession: (session: Session, deadline: AbortSignal) => Promise<number>;
  /** P2.04s `destroyAllForDid` (`user_signout_all`): every session and the token set. */
  destroyAllSessions: (session: Session, deadline: AbortSignal) => Promise<number>;
  /**
   * `OAuthClient.revoke` (@atproto/oauth-client 0.8.9, dist/oauth-client.js `revoke`). On success the library has
   * deleted the stored set. A throw means the authorization server was not confirmed; the set may still be there.
   */
  revokeGrant: (did: Did) => Promise<void>;
  /** `oauthSessionStore.del`: used when revoke throws, so no grant remains on our side. */
  deleteTokenSet: (did: Did, deadline: AbortSignal) => Promise<void>;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
  pdsHost: string;
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

/** The one value of `name`, or null when it is missing or repeated. */
function single(form: URLSearchParams, name: string): string | null {
  const values = form.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

function finish(location: string): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  headers.append("set-cookie", sessionClearCookie());
  // A sign-in started before this one ends here too: its authorization was made without prompt=login.
  headers.append("set-cookie", clearNonceCookie());
  headers.append("set-cookie", clearTargetCookie());
  headers.append("set-cookie", signedOutCookie());
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
  /** Revoke first. On any failure the stored set is deleted here; the caller still ends the sessions. */
  async function revokeOrDrop(did: Did, deadline: AbortSignal): Promise<boolean> {
    try {
      await withTimeout(deps.revokeGrant(did), deadline);
      return true;
    } catch (cause: unknown) {
      deps.log.warn("oauth.revoke_failed", { kind: className(cause) });
      await deps.deleteTokenSet(did, deadline).catch((drop: unknown) => {
        deps.log.warn("oauth.revoke_failed", { kind: className(drop) });
      });
      return false;
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
        if (session !== null) {
          // A failed delete is a retryable 503 (book P2.08 step 3), and the cookie stays so the retry finds it.
          const remaining = await deps.destroySession(session, deadline).catch((cause: unknown) => {
            throw new AppError("service.unavailable", { cause });
          });
          deps.log.info("auth.logout_this_browser");
          // Last browser: revoke outside the transaction. The count saw this delete. No unconfirmed notice (F13).
          if (remaining === 0) await revokeOrDrop(session.did, deadline);
        }
        return finish("/signed-out");
      },
    }),
    defineRoute({
      method: "POST",
      path: "/logout/everywhere",
      group: "app",
      accepts: [FORM],
      bodyLimit: 1024,
      rateLimit: "default",
      mutates: true,
      session: "none",
      handler: async ({ request, deadline }) => {
        const session = await deps.readSession(request, deadline);
        if (session === null) return finish("/signed-out");
        const form = new URLSearchParams(await request.text());
        // Plan §2 rule 15: the catalog code rides on `error=`, which is what withErrorParam writes.
        if (single(form, "confirm") !== "yes") {
          return new Response(null, {
            status: 303,
            headers: {
              location: withErrorParam("/settings", "logout.confirm_required"),
              "cache-control": "no-store",
            },
          });
        }
        // Revoke while the token set is still there. end_sessions_for_did deletes it (migration 0014).
        const revoked = await revokeOrDrop(session.did, deadline);
        await deps.destroyAllSessions(session, deadline).catch((cause: unknown) => {
          throw new AppError("service.unavailable", { cause });
        });
        deps.log.info("auth.logout_everywhere");
        if (!revoked) deps.log.info("auth.revoke_unconfirmed");
        const location = revoked
          ? "/signed-out?scope=everywhere"
          : withErrorParam("/signed-out?scope=everywhere", "logout.revoke_unconfirmed");
        return finish(location);
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
        const query = new URL(request.url).searchParams;
        return deps.page({
          group: "app",
          request,
          title: "Signed out",
          shell: {},
          body: deps.screens.signedOut({
            pdsHost: deps.pdsHost,
            everywhere: query.get("scope") === "everywhere",
            revokeUnconfirmed: readErrorParam(query) === "logout.revoke_unconfirmed",
          }),
        });
      },
    }),
  ];
}
